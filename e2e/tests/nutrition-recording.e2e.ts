import path from "node:path";
import { mkdirSync } from "node:fs";
import { NUTRITION_SCHEMA_VERSION } from "../../shared/nutrition";
import { expectEmulatorOnlyTraffic, e2ePassword, formatKcal, openNutrition, signIn } from "../support/browser";
import { expect, test } from "../support/fixtures";
import { baseMealOf } from "../support/nutritionState";
import {
  SLOT_LABELS,
  hardReload,
  navigateWithBottomNav,
  openReplaceSheet,
  recordPlannedMeal,
  removeRecording,
  replaceSlot,
  slotRow,
  weekRow,
  type E2ESlotId,
} from "../support/nutritionUi";
import { E2E_LOCAL_DIR } from "../support/processEnv";

/**
 * NUT-13B §1, §2, §8 — recording on the populated adult account, in the real
 * app against the emulators.
 *
 * RECORDED is only ever what the person explicitly confirmed: the UI must
 * show the persisted entry, never infer it from the plan, and a recorded
 * snapshot is fixed at the moment of recording. TARGET and the base plan are
 * never touched by recording.
 */

const SCREENSHOTS = path.join(E2E_LOCAL_DIR, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const SLOTS: E2ESlotId[] = ["breakfast", "lunch", "dinner"];

test("recording: confirming today's planned breakfast persists exactly that snapshot and changes nothing else", async ({
  page,
  seed,
  network,
  persisted,
}) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const today = seed.today;
  const before = await persisted(adult.uid);
  // A freshly seeded account: a target and a plan, nothing recorded, nothing replaced.
  expect(before.entries).toEqual({});
  expect(before.slots).toEqual({});
  const plan = before.plans[nutrition.planId];
  const planned = baseMealOf(plan, today, "breakfast");

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await expect(page.getByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "today");

  // TARGET: the active target's values.
  await expect(page.getByTestId("nutrition-v2-target")).toHaveAttribute("data-target-status", "success");
  const targetTexts = async () =>
    Promise.all(
      (["kcal", "proteinG", "carbsG", "fatG"] as const).map((key) => page.getByTestId(`nutrition-v2-target-${key}`).innerText())
    );
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(nutrition.target.kcal));
  const targetBefore = await targetTexts();

  // TODAY: planned is not consumed. Every slot shows its planned meal and "Nicht erfasst".
  for (const slotId of SLOTS) {
    const row = slotRow(page, slotId);
    await expect(row).toContainText(nutrition.meals[today][slotId]);
    await expect(row).toHaveAttribute("data-recorded", "none");
    await expect(row.getByTestId("nutrition-v2-slot-recorded")).toHaveText("Nicht erfasst");
  }
  // WEEK: nothing is recorded on any day, whatever the plan says.
  for (const date of nutrition.dates) await expect(weekRow(page, date)).toHaveAttribute("data-recording", "unrecorded");

  // Opening the sheet and cancelling writes nothing.
  await slotRow(page, "breakfast").getByRole("button", { name: "Frühstück erfassen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect((await persisted(adult.uid)).entries).toEqual({});

  // The explicit action.
  await recordPlannedMeal(page, "breakfast");

  const breakfast = slotRow(page, "breakfast");
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(breakfast.getByTestId("nutrition-v2-slot-recorded")).toHaveText(`Erfasst · ca. ${formatKcal(planned.values.kcal)} kcal`);
  await expect(breakfast.getByRole("button", { name: "Frühstück bearbeiten" })).toBeVisible();
  for (const slotId of ["lunch", "dinner"] as const) await expect(slotRow(page, slotId)).toHaveAttribute("data-recorded", "none");
  await expect(weekRow(page, today)).toHaveAttribute("data-recording", "partial");
  for (const date of nutrition.dates.filter((date) => date !== today)) {
    await expect(weekRow(page, date)).toHaveAttribute("data-recording", "unrecorded");
  }
  expect(await targetTexts()).toEqual(targetBefore);

  // SERVER: exactly one new document, the recorded entry of today's breakfast.
  const after = await persisted(adult.uid);
  const entryId = `slot:${today}:breakfast`;
  expect(Object.keys(after.entries)).toEqual([entryId]);
  const entry = after.entries[entryId];
  // The effective planned meal at the moment of recording, as a snapshot.
  expect(entry).toEqual({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    entryId,
    kind: "slot",
    date: today,
    slotId: "breakfast",
    recording: "plannedMeal",
    planId: nutrition.planId,
    name: planned.name,
    estimateBasis: "planMealTimesPortion",
    portion: 1,
    nutritionEstimate: planned.values,
    revision: 1,
    status: "active",
    appliedIntentIds: [expect.stringMatching(/^[0-9a-f-]{36}$/)],
  });
  // Nothing else: the base plan, TARGET, state and slot heads are exactly as seeded.
  expect(after.plans).toEqual(before.plans);
  expect(after.targets).toEqual(before.targets);
  expect(after.state).toEqual(before.state);
  expect(after.slots).toEqual({});
  expect(after.generationIds).toEqual([]);
  expect(after.collections).toEqual([...before.collections, "nutrition_v2_entries"].sort());
  expect(after.profile).toEqual(before.profile);

  // Immediate normal reload: the same RECORDED entry, read back from the emulator.
  await page.reload();
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(breakfast.getByTestId("nutrition-v2-slot-recorded")).toHaveText(`Erfasst · ca. ${formatKcal(planned.values.kcal)} kcal`);
  await expect(slotRow(page, "lunch")).toHaveAttribute("data-recorded", "none");

  // Hard reload, then leave Nutrition and come back through the bottom navigation.
  await hardReload(page);
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await navigateWithBottomNav(page, "Profil");
  await expect(page.getByTestId("nutrition-v2-today")).toHaveCount(0);
  await navigateWithBottomNav(page, "Ernährungsplan");
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(weekRow(page, today)).toHaveAttribute("data-recording", "partial");
  expect(await targetTexts()).toEqual(targetBefore);

  // Reading never writes: the entry is still revision 1 with its one intent.
  expect((await persisted(adult.uid)).entries).toEqual(after.entries);
  expectEmulatorOnlyTraffic(network, { functions: false });
});

test("recorded snapshot: reloads, a replacement elsewhere and another device's removal never rewrite it", async ({
  page,
  browser,
  seed,
  persisted,
}) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const today = seed.today;
  const entryId = `slot:${today}:breakfast`;

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await recordPlannedMeal(page, "breakfast");
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  const recorded = (await persisted(adult.uid)).entries[entryId];
  expect(recorded).toMatchObject({ recording: "plannedMeal", name: nutrition.meals[today].breakfast, revision: 1 });

  // Refresh, reload and hard reload read the entry; none of them writes it.
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await page.reload();
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  await hardReload(page);
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  expect((await persisted(adult.uid)).entries[entryId]).toEqual(recorded);

  // The product permits replacing ANOTHER slot's planned meal: the recorded breakfast is untouched.
  const lunchReplacement = nutrition.meals[nutrition.dates[nutrition.dates.indexOf(today) + 1]].lunch;
  await replaceSlot(page, "lunch", lunchReplacement);
  await expect(slotRow(page, "lunch")).toContainText(lunchReplacement);
  const afterReplacement = await persisted(adult.uid);
  expect(afterReplacement.entries).toEqual({ [entryId]: recorded });
  expect(Object.keys(afterReplacement.slots)).toEqual([`${nutrition.planId}__${today}__lunch`]);

  // Breakfast itself can no longer be replaced once recorded (NUT-10): the sheet says so and offers nothing.
  const sheet = await openReplaceSheet(page, "breakfast");
  await expect(sheet.getByTestId("nutrition-v2-replace-blocked")).toContainText("bereits erfasst");
  await expect(sheet.getByRole("button", { name: "Ersetzen", exact: true })).toBeDisabled();
  for (const radio of await sheet.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Another device of the same account removes the recording through its own UI.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, adult.email, e2ePassword());
  await openNutrition(otherPage);
  await expect(slotRow(otherPage, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  await removeRecording(otherPage, "breakfast");
  await expect(slotRow(otherPage, "breakfast")).toHaveAttribute("data-recorded", "none");
  await other.close();

  // This device shows what is persisted — a tombstone reads as not recorded — once it reads again.
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "none");
  await expect(slotRow(page, "breakfast").getByTestId("nutrition-v2-slot-recorded")).toHaveText("Nicht erfasst");
  // The tombstone keeps the snapshot it had: only status, revision and the intent ring moved.
  const tombstone = (await persisted(adult.uid)).entries[entryId];
  expect(tombstone).toEqual({
    ...recorded,
    status: "removed",
    revision: 2,
    appliedIntentIds: [...recorded.appliedIntentIds, expect.stringMatching(/^[0-9a-f-]{36}$/)],
  });
});

test("TARGET, Today and Week: recording all of today's slots marks the day recorded and never moves the target", async ({
  page,
  seed,
  persisted,
}) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const today = seed.today;
  const before = await persisted(adult.uid);

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);

  // Week: seven dates, in order, today marked — the plan's own dates.
  const rows = page.getByTestId("nutrition-v2-week-row");
  await expect(rows).toHaveCount(7);
  const dates = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-date")));
  expect(dates).toEqual(nutrition.dates);
  expect([...dates].sort()).toEqual(dates);
  await expect(page.locator('[data-testid="nutrition-v2-week-row"][aria-current="date"]')).toHaveCount(1);
  await expect(weekRow(page, today)).toHaveAttribute("aria-current", "date");
  await expect(weekRow(page, today)).toContainText("Heute");
  const weekTexts = await rows.allInnerTexts();

  for (const slotId of SLOTS) {
    await recordPlannedMeal(page, slotId);
    await expect(slotRow(page, slotId)).toHaveAttribute("data-recorded", "plannedMeal");
    await expect(weekRow(page, today)).toHaveAttribute("data-recording", slotId === "dinner" ? "recorded" : "partial");
  }
  await expect(weekRow(page, today)).toContainText("Erfasst");
  // Recording changes the day's recording status, never its planned kcal or another day.
  const weekAfter = await rows.allInnerTexts();
  for (const [index, date] of nutrition.dates.entries()) {
    if (date === today) {
      expect(weekAfter[index].replace("Erfasst", "Nicht erfasst")).toBe(weekTexts[index]);
    } else {
      expect(weekAfter[index]).toBe(weekTexts[index]);
    }
  }

  await page.reload();
  await expect(weekRow(page, today)).toHaveAttribute("data-recording", "recorded");
  for (const slotId of SLOTS) {
    await expect(slotRow(page, slotId)).toHaveAttribute("data-recorded", "plannedMeal");
    await expect(slotRow(page, slotId)).toContainText(SLOT_LABELS[slotId]);
  }
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(nutrition.target.kcal));

  const after = await persisted(adult.uid);
  expect(Object.keys(after.entries).sort()).toEqual(SLOTS.map((slotId) => `slot:${today}:${slotId}`).sort());
  expect(after.targets).toEqual(before.targets);
  expect(after.plans).toEqual(before.plans);
  expect(after.state).toEqual(before.state);
  await page.screenshot({ path: path.join(SCREENSHOTS, "nut13b-recording-day-recorded-desktop.png"), fullPage: true });
});
