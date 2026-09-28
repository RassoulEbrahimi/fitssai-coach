import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { expectEmulatorOnlyTraffic, e2ePassword, formatKcal, openNutrition, signIn } from "../support/browser";
import { callEmulatorCallable, emulatorIdToken } from "../support/emulatorRest";
import { expect, test } from "../support/fixtures";
import { baseMealOf } from "../support/nutritionState";
import {
  openReplaceSheet,
  recordPlannedMeal,
  removeRecording,
  replaceSlot,
  slotRow,
  undoSlot,
  weekRow,
} from "../support/nutritionUi";
import { E2E_LOCAL_DIR } from "../support/processEnv";

/**
 * NUT-13B §3, §4 — replacing today's planned meal and undoing it (NUT-10),
 * through the real sheet and `nutritionUpdateSlot` on the Functions emulator,
 * and the locked rule that a RECORDED slot's planned meal is never changed.
 *
 * A replacement is a new revision of that one date+slot's slot head; the base
 * plan, the TARGET, other slots and other dates never change, and nothing is
 * recorded by it.
 */

const SCREENSHOTS = path.join(E2E_LOCAL_DIR, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const headId = (planId: string, date: string, slotId: string) => `${planId}__${date}__${slotId}`;

test("replacement: only today's breakfast changes, survives reload, and Undo restores the base meal once", async ({
  page,
  seed,
  network,
  persisted,
}) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const today = seed.today;
  const before = await persisted(adult.uid);
  const plan = before.plans[nutrition.planId];
  const base = baseMealOf(plan, today, "breakfast");
  const tomorrow = nutrition.dates[nutrition.dates.indexOf(today) + 1];
  const source = baseMealOf(plan, tomorrow, "breakfast");
  const breakfastHead = headId(nutrition.planId, today, "breakfast");

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  const breakfast = slotRow(page, "breakfast");
  await expect(breakfast).toContainText(base.name);
  const rows = page.getByTestId("nutrition-v2-week-row");
  await expect(rows).toHaveCount(7);
  const weekBefore = await rows.allInnerTexts();
  const lunchBefore = await slotRow(page, "lunch").innerText();
  const dinnerBefore = await slotRow(page, "dinner").innerText();
  const targetBefore = await page.getByTestId("nutrition-v2-target-values").innerText();

  // The sheet offers the plan's OTHER breakfasts only, never today's own or another slot's meal.
  const sheet = await openReplaceSheet(page, "breakfast");
  await expect(sheet.getByTestId("nutrition-v2-replace-current")).toContainText(base.name);
  const offered = await sheet.getByRole("radio").evaluateAll((radios) => radios.length);
  expect(offered).toBe(nutrition.dates.length - 1);
  await expect(sheet.getByRole("radio", { name: new RegExp(base.name) })).toHaveCount(0);
  await expect(sheet.getByRole("radio", { name: new RegExp(nutrition.meals[today].lunch) })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Rückgängig" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await replaceSlot(page, "breakfast", source.name);

  // UI: breakfast shows the replacement, marked; lunch, dinner and TARGET as before; nothing recorded.
  await expect(breakfast).toContainText(source.name);
  await expect(breakfast).not.toContainText(base.name);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toBeVisible();
  await expect(breakfast).toHaveAttribute("data-recorded", "none");
  expect(await slotRow(page, "lunch").innerText()).toBe(lunchBefore);
  expect(await slotRow(page, "dinner").innerText()).toBe(dinnerBefore);
  expect(await page.getByTestId("nutrition-v2-target-values").innerText()).toBe(targetBefore);
  // Week: only today's planned kcal moves; every other day is exactly as before.
  const todayMeals = plan.days.find((day) => day.date === today)!.meals;
  const replacedDayKcal = todayMeals.reduce((sum, meal) => sum + (meal.slotId === "breakfast" ? source.values.kcal : meal.values.kcal), 0);
  await expect(weekRow(page, today)).toContainText(`${formatKcal(replacedDayKcal)} kcal geplant`);
  const weekAfter = await rows.allInnerTexts();
  for (const [index, date] of nutrition.dates.entries()) {
    if (date !== today) expect(weekAfter[index]).toBe(weekBefore[index]);
  }
  await expect(weekRow(page, today)).toHaveAttribute("data-recording", "unrecorded");

  // SERVER: one slot head, for this plan, date and slot; nothing else changed.
  const replaced = await persisted(adult.uid);
  expect(Object.keys(replaced.slots)).toEqual([breakfastHead]);
  const head = replaced.slots[breakfastHead];
  expect(head).toMatchObject({ planId: nutrition.planId, date: today, slotId: "breakfast", revision: 1 });
  expect(head.selection.kind).toBe("override");
  const overrideId = head.selection.kind === "override" ? head.selection.overrideId : "";
  expect(Object.keys(head.overrides)).toEqual([overrideId]);
  const override = head.overrides[overrideId];
  expect(override).toMatchObject({
    planId: nutrition.planId,
    date: today,
    slotId: "breakfast",
    baseMealId: base.mealId,
    previousOverrideId: null,
    source: { kind: "planMeal", sourceMealId: source.mealId },
    createdAtRevision: 1,
  });
  // A copy of the source meal for this slot, with its own meal id.
  expect(override.meal).toMatchObject({ name: source.name, values: source.values, slotId: "breakfast" });
  expect(override.meal.mealId).not.toBe(source.mealId);
  expect(head.appliedRequestIds).toHaveLength(1);
  expect(replaced.plans).toEqual(before.plans);
  expect(replaced.targets).toEqual(before.targets);
  expect(replaced.state).toEqual(before.state);
  expect(replaced.entries).toEqual({});
  expect(replaced.collections).toEqual([...before.collections, "nutrition_v2_slots"].sort());

  // Immediate reload: the replacement is read back from the server.
  await page.reload();
  await expect(breakfast).toContainText(source.name);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toBeVisible();
  await expect(breakfast).toHaveAttribute("data-recorded", "none");
  await page.screenshot({ path: path.join(SCREENSHOTS, "nut13b-replacement-replaced-desktop.png"), fullPage: true });

  // UNDO through the sheet.
  const undoSheet = await openReplaceSheet(page, "breakfast");
  await expect(undoSheet.getByTestId("nutrition-v2-replace-current")).toContainText(source.name);
  await page.keyboard.press("Escape");
  await expect(undoSheet).toBeHidden();
  await undoSlot(page, "breakfast");
  await expect(breakfast).toContainText(base.name);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toHaveCount(0);
  await expect(weekRow(page, today)).toContainText(weekBefore[nutrition.dates.indexOf(today)].split("\n").find((line) => line.includes("kcal"))!);
  expect(await rows.allInnerTexts()).toEqual(weekBefore);

  // SERVER: the same head, one revision later, selecting base. The override stays in the history; nothing is duplicated.
  const undone = await persisted(adult.uid);
  expect(Object.keys(undone.slots)).toEqual([breakfastHead]);
  const undoneHead = undone.slots[breakfastHead];
  expect(undoneHead.revision).toBe(2);
  expect(undoneHead.selection).toEqual({ kind: "base" });
  expect(undoneHead.overrides).toEqual(head.overrides);
  expect(undoneHead.appliedRequestIds).toHaveLength(2);
  expect(new Set(undoneHead.appliedRequestIds).size).toBe(2);
  expect(undoneHead.appliedRequestIds[0]).toBe(head.appliedRequestIds[0]);
  expect(undone.plans).toEqual(before.plans);
  expect(undone.targets).toEqual(before.targets);
  expect(undone.state).toEqual(before.state);
  expect(undone.entries).toEqual({});

  await page.reload();
  await expect(breakfast).toContainText(base.name);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toHaveCount(0);
  // After undo there is nothing left to undo.
  const finalSheet = await openReplaceSheet(page, "breakfast");
  await expect(finalSheet.getByRole("button", { name: "Rückgängig" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect((await persisted(adult.uid)).slots).toEqual(undone.slots);

  expectEmulatorOnlyTraffic(network, { functions: true });
});

test("recording vs replacement: a recorded slot's planned meal is locked in the UI and on the server", async ({ page, seed, env, persisted }) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const today = seed.today;
  const before = await persisted(adult.uid);
  const plan = before.plans[nutrition.planId];
  const dates = nutrition.dates;
  const source = baseMealOf(plan, dates[dates.indexOf(today) + 1], "breakfast");
  const another = baseMealOf(plan, dates[dates.indexOf(today) + 2], "breakfast");
  const breakfastHead = headId(nutrition.planId, today, "breakfast");
  const breakfastEntry = `slot:${today}:breakfast`;

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);

  // Replace, then record the replacement: the snapshot is the EFFECTIVE planned meal.
  await replaceSlot(page, "breakfast", source.name);
  await expect(slotRow(page, "breakfast")).toContainText(source.name);
  await recordPlannedMeal(page, "breakfast");
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  const recorded = await persisted(adult.uid);
  const head = recorded.slots[breakfastHead];
  const overrideId = head.selection.kind === "override" ? head.selection.overrideId : "";
  const entry = recorded.entries[breakfastEntry];
  expect(entry).toMatchObject({
    recording: "plannedMeal",
    planId: nutrition.planId,
    name: source.name,
    nutritionEstimate: source.values,
    portion: 1,
    revision: 1,
    status: "active",
  });

  // UI: the replace sheet says why and offers no action — neither another meal nor Undo.
  const sheet = await openReplaceSheet(page, "breakfast");
  await expect(sheet.getByTestId("nutrition-v2-replace-blocked")).toHaveText(
    "Diese Mahlzeit ist bereits erfasst. Danach kann das geplante Gericht nicht mehr geändert werden."
  );
  await expect(sheet.getByRole("button", { name: "Ersetzen", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Rückgängig" })).toBeDisabled();
  for (const radio of await sheet.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // SERVER: the same account calling nutritionUpdateSlot directly is refused, whatever the UI shows.
  const token = await emulatorIdToken(env, adult.uid, adult.email, e2ePassword());
  const address = { planId: nutrition.planId, date: today, slotId: "breakfast" };
  const undo = await callEmulatorCallable(env, "nutritionUpdateSlot", token, {
    action: "undo",
    requestId: randomUUID(),
    ...address,
    expectedRevision: 1,
  });
  expect(undo).toEqual({ status: 400, body: { error: { message: "SLOT_HAS_RECORD", status: "FAILED_PRECONDITION" } } });
  const commit = await callEmulatorCallable(env, "nutritionUpdateSlot", token, {
    action: "commit",
    requestId: randomUUID(),
    ...address,
    expectedRevision: 1,
    replacement: { source: "planMeal", sourceMealId: another.mealId },
  });
  expect(commit).toEqual({ status: 400, body: { error: { message: "SLOT_HAS_RECORD", status: "FAILED_PRECONDITION" } } });
  // A stale revision is refused as stale first (compare-and-set before the record check), never applied.
  const stale = await callEmulatorCallable(env, "nutritionUpdateSlot", token, {
    action: "commit",
    requestId: randomUUID(),
    ...address,
    expectedRevision: 0,
    replacement: { source: "planMeal", sourceMealId: another.mealId },
  });
  expect(stale.status).toBe(409);
  expect(stale.body).toEqual({ error: { message: "STALE_REVISION", status: "ABORTED", details: { currentRevision: 1 } } });

  // A recorded BASE meal is locked the same way: no head is ever created for it.
  await recordPlannedMeal(page, "lunch");
  await expect(slotRow(page, "lunch")).toHaveAttribute("data-recorded", "plannedMeal");
  const lunch = await callEmulatorCallable(env, "nutritionUpdateSlot", token, {
    action: "commit",
    requestId: randomUUID(),
    planId: nutrition.planId,
    date: today,
    slotId: "lunch",
    expectedRevision: 0,
    replacement: { source: "planMeal", sourceMealId: baseMealOf(plan, dates[dates.indexOf(today) + 1], "lunch").mealId },
  });
  expect(lunch).toEqual({ status: 400, body: { error: { message: "SLOT_HAS_RECORD", status: "FAILED_PRECONDITION" } } });

  const locked = await persisted(adult.uid);
  expect(locked.slots).toEqual({ [breakfastHead]: head });
  expect(locked.entries[breakfastEntry]).toEqual(entry);
  expect(locked.plans).toEqual(before.plans);
  expect(locked.targets).toEqual(before.targets);

  // Taking the recording back (a tombstone) releases the slot, as NUT-10 specifies; the tombstone keeps its snapshot.
  await removeRecording(page, "breakfast");
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "none");
  await undoSlot(page, "breakfast");
  await expect(slotRow(page, "breakfast")).toContainText(baseMealOf(plan, today, "breakfast").name);
  const released = await persisted(adult.uid);
  expect(released.slots[breakfastHead]).toMatchObject({ revision: 2, selection: { kind: "base" } });
  expect(Object.keys(released.slots[breakfastHead].overrides)).toEqual([overrideId]);
  expect(released.entries[breakfastEntry]).toEqual({
    ...entry,
    status: "removed",
    revision: 2,
    appliedIntentIds: [...entry.appliedIntentIds, expect.stringMatching(/^[0-9a-f-]{36}$/)],
  });
  // The recorded lunch is untouched throughout.
  expect(released.entries[`slot:${today}:lunch`]).toEqual(locked.entries[`slot:${today}:lunch`]);
});
