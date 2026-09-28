import type { Page } from "@playwright/test";
import { e2ePassword, openNutrition, signIn } from "../support/browser";
import { expect, test } from "../support/fixtures";
import { baseMealOf } from "../support/nutritionState";
import {
  escapeRegExp,
  openRecordingSheet,
  openReplaceSheet,
  persistedEntryReads,
  persistedNutritionReads,
  persistedProfileRead,
  recordPlannedMeal,
  slotRow,
  waitForPersistedEntries,
  waitForPersistedSlotHeads,
} from "../support/nutritionUi";

/**
 * NUT-13B-FIX-01 — a reload right after a confirmed change shows the server's
 * state, never the persisted read from before the change.
 *
 * The defect: the account's query cache is saved to localStorage at most once
 * a second, and a restored read counted as fresh for its staleTime. A reload
 * inside that second restored the pre-change read and nothing refetched it —
 * a recording showed "Nicht erfasst", a replacement the base meal (and a
 * recording from there stored the BASE meal), a saved age "Noch offen".
 *
 * Each scenario makes that race deterministic: it lets the persister settle
 * first, makes the change, checks that the stored read is still the old one
 * (the save is still waiting), and reloads at once — no delay between the
 * confirmed change and the reload.
 */

/** The persister has written the first reads and is idle, so the next save waits a full throttle window. */
const settlePersister = (page: Page) => page.waitForTimeout(1_500);

test.describe("reload immediately after a confirmed change", () => {
  for (const moment of ["as soon as the server commit answers", "as soon as the slot shows it"] as const) {
    test(`recording: the recorded entry is shown after a reload ${moment}`, async ({ page, seed, persisted }) => {
      const adult = seed.users.adult;
      const entryId = `slot:${seed.today}:breakfast`;
      const breakfast = slotRow(page, "breakfast");

      await signIn(page, adult.email, e2ePassword());
      await openNutrition(page);
      await expect(breakfast).toHaveAttribute("data-recorded", "none");
      await waitForPersistedEntries(page, adult.uid, []);
      await settlePersister(page);

      const sheet = await openRecordingSheet(page, "breakfast");
      const committed = page.waitForResponse(
        (response) => response.url().includes("/documents:commit") && response.request().method() === "POST"
      );
      await sheet.getByRole("button", { name: "Speichern", exact: true }).click();
      expect((await committed).status()).toBe(200);
      if (moment === "as soon as the slot shows it") await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
      // The race: the server has the entry, the stored read does not yet.
      expect(Object.keys((await persisted(adult.uid)).entries)).toEqual([entryId]);
      expect((await persistedEntryReads(page, adult.uid)).map((read) => read.entryIds)).toEqual([[]]);
      await page.reload();

      await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
      await expect(breakfast.getByTestId("nutrition-v2-slot-recorded")).not.toHaveText("Nicht erfasst");
      // Written once; the reload wrote nothing.
      const entries = (await persisted(adult.uid)).entries;
      expect(Object.keys(entries)).toEqual([entryId]);
      expect(entries[entryId]).toMatchObject({ status: "active", revision: 1, recording: "plannedMeal" });
      expect(entries[entryId].appliedIntentIds).toHaveLength(1);
    });
  }

  test("replacement: the replaced meal is shown after a reload, and a recording from there stores the replacement", async ({
    page,
    seed,
    persisted,
  }) => {
    const adult = seed.users.adult;
    const nutrition = adult.nutrition!;
    const before = await persisted(adult.uid);
    const plan = before.plans[nutrition.planId];
    const base = baseMealOf(plan, seed.today, "breakfast");
    const source = baseMealOf(plan, nutrition.dates[nutrition.dates.indexOf(seed.today) + 1], "breakfast");
    const breakfast = slotRow(page, "breakfast");

    await signIn(page, adult.email, e2ePassword());
    await openNutrition(page);
    await expect(breakfast).toContainText(base.name);
    await waitForPersistedSlotHeads(page, adult.uid, []);
    await settlePersister(page);

    const sheet = await openReplaceSheet(page, "breakfast");
    await sheet.getByRole("radio", { name: new RegExp(`^${escapeRegExp(source.name)} ·`) }).check();
    await sheet.getByRole("button", { name: "Ersetzen", exact: true }).click();
    await expect(breakfast).toContainText(source.name);
    // The race: the server has the override, the stored slot-heads read is still empty.
    expect(Object.values((await persisted(adult.uid)).slots).map((head) => head.selection.kind)).toEqual(["override"]);
    expect((await persistedNutritionReads(page, adult.uid, "slots")).map((read) => read.data)).toEqual([[]]);
    await page.reload();

    await expect(breakfast).toContainText(source.name);
    await expect(breakfast).not.toContainText(base.name);
    await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toBeVisible();

    // Recording from the reloaded screen snapshots the EFFECTIVE planned meal.
    await recordPlannedMeal(page, "breakfast");
    await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
    const after = await persisted(adult.uid);
    expect(after.entries[`slot:${seed.today}:breakfast`]).toMatchObject({
      recording: "plannedMeal",
      name: source.name,
      nutritionEstimate: source.values,
      revision: 1,
    });
    // The base plan is immutable throughout.
    expect(after.plans).toEqual(before.plans);
  });

  test("profile: a saved age is shown after a reload", async ({ page, seed, persisted }) => {
    const user = seed.users.missingAge;
    await signIn(page, user.email, e2ePassword());
    await openNutrition(page);
    const card = page.getByTestId("nutrition-v2-today");
    await expect(card).toHaveAttribute("data-view", "ineligible");
    await expect.poll(async () => (await persistedProfileRead(page, user.uid)) !== null, { timeout: 10_000 }).toBe(true);
    await settlePersister(page);

    await page.getByRole("button", { name: "Angaben ergänzen" }).click();
    const sheet = page.getByTestId("nutrition-v2-profile-sheet");
    await sheet.getByLabel("Alter").fill("30");
    await sheet.getByRole("button", { name: "Speichern" }).click();
    await expect(card).toHaveAttribute("data-view", "notInitialized");
    // The race: the server has the age, the stored profile read does not yet.
    expect((await persisted(user.uid)).profile?.age).toBe(30);
    expect(((await persistedProfileRead(page, user.uid))?.data as { age?: number } | null)?.age ?? null).toBeNull();
    await page.reload();

    await expect(card).toHaveAttribute("data-view", "notInitialized");
    await expect(page.getByTestId("nutrition-v2-profile-completion")).toHaveAttribute("data-profile-status", "complete");
    await expect(page.getByText("Noch offen: Alter")).toHaveCount(0);
  });
});

test("a change made on another device is shown after a reload, even when this device's stored read is recent", async ({
  page,
  browser,
  seed,
  persisted,
}) => {
  const adult = seed.users.adult;
  const breakfast = slotRow(page, "breakfast");

  // This device has read and stored today's entries: nothing recorded.
  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await expect(breakfast).toHaveAttribute("data-recorded", "none");
  await waitForPersistedEntries(page, adult.uid, []);

  // Another device records breakfast.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, adult.email, e2ePassword());
  await openNutrition(otherPage);
  await recordPlannedMeal(otherPage, "breakfast");
  await expect(slotRow(otherPage, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  await other.close();
  expect(Object.keys((await persisted(adult.uid)).entries)).toEqual([`slot:${seed.today}:breakfast`]);

  // This device's stored read is seconds old — inside staleTime — and still says "nothing".
  expect((await persistedEntryReads(page, adult.uid)).map((read) => read.entryIds)).toEqual([[]]);
  await page.reload();
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
});
