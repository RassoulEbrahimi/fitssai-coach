import { expect as baseExpect, type Page } from "@playwright/test";
import { e2ePassword, formatKcal, openNutrition, signIn, submitSignIn } from "../support/browser";
import { expect, test } from "../support/fixtures";
import {
  bottomNav,
  documentMarked,
  markDocument,
  navigateWithBottomNav,
  persistedQueryCacheKey,
  readOfflineQueue,
  recordPlannedMeal,
  slotRow,
} from "../support/nutritionUi";

/**
 * NUT-13B §6 — two accounts, one after the other, in ONE browser document.
 *
 * Signing out and in goes through the product's own UI (Profil → Abmelden,
 * then the sign-in form the app navigates to), and the page is never
 * reloaded between accounts, so any account state kept in memory — the
 * query cache, the recording hooks, the handoff — would show if it leaked.
 * The offline queue is per device but owner-scoped: an entry queued by A is
 * replayed only while A is signed in.
 */

const MARKER = "__nut13bAccountSwitch";

const signOutThroughProfile = async (page: Page) => {
  await navigateWithBottomNav(page, "Profil");
  await page.getByRole("button", { name: "Abmelden" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Möchtest du dich wirklich abmelden?");
  await confirm.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(/\/fitssai-coach\/auth\/sign-in/);
  await expect(page.locator("#auth-email")).toBeVisible();
};

test("account switch in one browser: B never sees A's data or queued change, and A's queue replays only as A", async ({
  page,
  context,
  seed,
  persisted,
}) => {
  const a = seed.users.adult;
  const b = seed.users.isolation;
  const aNutrition = a.nutrition!;
  const bNutrition = b.nutrition!;
  const today = seed.today;
  const aMealNames = Object.values(aNutrition.meals).flatMap((meals) => Object.values(meals));

  // A: sign in, see A's TARGET and plan, record breakfast online.
  await signIn(page, a.email, e2ePassword());
  await openNutrition(page);
  await markDocument(page, MARKER);
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(aNutrition.target.kcal));
  await expect(page.getByTestId("nutrition-v2-week-row").first()).toHaveAttribute("data-plan-id", aNutrition.planId);
  await recordPlannedMeal(page, "breakfast");
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
  // Load the profile view once while online, so signing out offline needs no download.
  await navigateWithBottomNav(page, "Profil");
  await navigateWithBottomNav(page, "Ernährungsplan");

  // A, offline: record lunch — queued on this device, owned by A.
  await context.setOffline(true);
  await recordPlannedMeal(page, "lunch");
  await expect(slotRow(page, "lunch").getByTestId("nutrition-v2-pending")).toBeVisible();
  const aQueue = await readOfflineQueue(page);
  expect(aQueue).toHaveLength(1);
  expect(aQueue[0]).toMatchObject({ ownerUid: a.uid, payload: { intent: { entryId: `slot:${today}:lunch` } } });

  // Sign A out through the product UI, still offline, then come back online with nobody signed in.
  await signOutThroughProfile(page);
  await context.setOffline(false);
  await page.waitForTimeout(6_000);
  // Nobody signed in: nothing replayed, A's entry is still A's.
  expect(await readOfflineQueue(page)).toEqual(aQueue);
  expect(Object.keys((await persisted(a.uid)).entries)).toEqual([`slot:${today}:breakfast`]);

  // B: sign in on the same page (no reload), open Nutrition from the bottom navigation.
  await submitSignIn(page, b.email, e2ePassword());
  await navigateWithBottomNav(page, "Ernährungsplan");
  const card = page.getByTestId("nutrition-v2-today");
  await expect(card).toHaveAttribute("data-view", "today");
  expect(await documentMarked(page, MARKER)).toBe(true);

  // B sees B's TARGET, plan and meals…
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(bNutrition.target.kcal));
  await expect(page.getByTestId("nutrition-v2-target-kcal")).not.toContainText(formatKcal(aNutrition.target.kcal));
  const rows = page.getByTestId("nutrition-v2-week-row");
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) await expect(row).toHaveAttribute("data-plan-id", bNutrition.planId);
  for (const slotId of ["breakfast", "lunch", "dinner"] as const) {
    await expect(slotRow(page, slotId)).toContainText(bNutrition.meals[today][slotId]);
    await expect(slotRow(page, slotId)).toHaveAttribute("data-recorded", "none");
  }
  // …and nothing of A's: no meal name, no recording, no pending change, no conflict.
  const text = await card.innerText();
  for (const name of aMealNames) baseExpect(text, `B's screen shows A's meal ${name}`).not.toContain(name);
  await expect(page.getByTestId("nutrition-v2-pending")).toHaveCount(0);
  await expect(page.getByText("Nicht übernommene Offline-Änderungen")).toHaveCount(0);
  for (const row of await rows.all()) await expect(row).toHaveAttribute("data-recording", "unrecorded");

  // B's session runs its queue replay (on sign-in and every 5 s): A's entry is never replayed as B.
  await page.waitForTimeout(7_000);
  expect(await readOfflineQueue(page)).toEqual(aQueue);
  expect((await persisted(b.uid)).entries).toEqual({});
  expect(Object.keys((await persisted(a.uid)).entries)).toEqual([`slot:${today}:breakfast`]);
  // B's persisted query cache holds nothing of A's.
  const bCache = (await page.evaluate((key) => localStorage.getItem(key), persistedQueryCacheKey(b.uid))) ?? "";
  expect(bCache).not.toContain(a.uid);
  expect(bCache).not.toContain(aNutrition.planId);

  // B out, A back in — still the same document.
  await signOutThroughProfile(page);
  await submitSignIn(page, a.email, e2ePassword());
  await navigateWithBottomNav(page, "Ernährungsplan");
  expect(await documentMarked(page, MARKER)).toBe(true);
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(aNutrition.target.kcal));
  await expect(slotRow(page, "breakfast")).toContainText(aNutrition.meals[today].breakfast);
  await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");

  // A's own queued lunch now replays — as A, with the intent it was queued with.
  await expect.poll(async () => (await readOfflineQueue(page)).length, { timeout: 20_000 }).toBe(0);
  const aEntries = (await persisted(a.uid)).entries;
  expect(Object.keys(aEntries).sort()).toEqual([`slot:${today}:breakfast`, `slot:${today}:lunch`]);
  expect(aEntries[`slot:${today}:lunch`]).toMatchObject({ revision: 1, status: "active", name: aNutrition.meals[today].lunch });
  expect(aEntries[`slot:${today}:lunch`].appliedIntentIds).toEqual([aQueue[0].payload.intent?.intentId]);
  await expect(slotRow(page, "lunch")).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(slotRow(page, "lunch").getByTestId("nutrition-v2-pending")).toHaveCount(0);
  expect((await persisted(b.uid)).entries).toEqual({});
  await expect(bottomNav(page)).toBeVisible();
});
