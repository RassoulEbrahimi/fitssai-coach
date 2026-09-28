import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { requireLocalEmulatorEnv } from "../support/emulatorEnv";
import { callEmulatorCallable, emulatorIdToken, getEmulatorDocument, listEmulatorDocumentIds } from "../support/emulatorRest";
import { E2E_LOCAL_DIR } from "../support/processEnv";
import {
  e2ePassword,
  expectEmulatorOnlyTraffic,
  formatKcal,
  guardNetwork,
  openNutrition,
  readSeedSummary,
  signIn,
} from "../support/browser";

/**
 * NUT-13A: the harness works end to end. The real app, signed in to the Auth
 * emulator, reads the seeded profile and Nutrition V2 data from the Firestore
 * emulator and reaches the Functions emulator — and nothing else.
 *
 * This proves the harness, not Nutrition V2: recording, reload persistence,
 * replacement semantics, offline reconciliation, account switching and narrow
 * layouts are NUT-13B, on this same harness.
 */

const summary = readSeedSummary();
const adult = summary.users.adult;
const adultNutrition = adult.nutrition!;
const SCREENSHOTS = path.join(E2E_LOCAL_DIR, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const SLOT_LABELS = { breakfast: "Frühstück", lunch: "Mittagessen", dinner: "Abendessen" } as const;

test("adult: local sign-in, seeded profile, TARGET, Today and Week come from the emulators", async ({ page, context }) => {
  const network = await guardNetwork(context);
  await signIn(page, adult.email, e2ePassword());

  // The profile document the seed wrote, read through the app's own profile query.
  await page.goto("dashboard#/profile");
  await expect(page.getByText("E2E Erwachsene Person A").first()).toBeVisible();

  await openNutrition(page);
  const card = page.getByTestId("nutrition-v2-today");
  // "today" needs an eligible adult (the seeded age) and a plan that owns today.
  await expect(card).toHaveAttribute("data-view", "today");

  // TARGET: the one nutritionSetTarget computed on the Functions emulator.
  await expect(page.getByTestId("nutrition-v2-target")).toHaveAttribute("data-target-status", "success");
  await expect(page.getByTestId("nutrition-v2-target-kcal")).toContainText(formatKcal(adultNutrition.target.kcal));
  await expect(page.getByTestId("nutrition-v2-target-proteinG")).toContainText(formatKcal(adultNutrition.target.proteinG));

  // Today: the seeded meals of today's date, in slot order, nothing recorded.
  const todaysMeals = adultNutrition.meals[summary.today];
  const slots = page.getByTestId("nutrition-v2-slot");
  await expect(slots).toHaveCount(3);
  for (const [index, slotId] of (["breakfast", "lunch", "dinner"] as const).entries()) {
    const slot = slots.nth(index);
    await expect(slot).toHaveAttribute("data-slot-id", slotId);
    await expect(slot).toHaveAttribute("data-recorded", "none");
    await expect(slot).toContainText(SLOT_LABELS[slotId]);
    await expect(slot).toContainText(todaysMeals[slotId]);
  }

  // Week: the plan's seven dates, in order, today marked.
  const rows = page.getByTestId("nutrition-v2-week-row");
  await expect(rows).toHaveCount(7);
  for (const [index, date] of adultNutrition.dates.entries()) {
    await expect(rows.nth(index)).toHaveAttribute("data-date", date);
    await expect(rows.nth(index)).toHaveAttribute("data-plan-id", adultNutrition.planId);
  }
  await expect(page.locator('[data-testid="nutrition-v2-week-row"][aria-current="date"]')).toHaveAttribute("data-date", summary.today);

  await page.screenshot({ path: path.join(SCREENSHOTS, "nut13a-adult-nutrition-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows).toHaveCount(7);
  await page.screenshot({ path: path.join(SCREENSHOTS, "nut13a-adult-nutrition-mobile-390.png"), fullPage: true });

  expectEmulatorOnlyTraffic(network, { functions: false });
});

test("adult: a Nutrition server interaction reaches the Functions emulator (replace, then undo)", async ({ page, context }) => {
  const network = await guardNetwork(context);
  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);

  const original = adultNutrition.meals[summary.today].breakfast;
  const tomorrow = adultNutrition.dates[adultNutrition.dates.indexOf(summary.today) + 1];
  const replacement = adultNutrition.meals[tomorrow].breakfast;
  const breakfast = page.locator('[data-testid="nutrition-v2-slot"][data-slot-id="breakfast"]');
  await expect(breakfast).toContainText(original);

  const updateSlot = (kind: string) =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).port === "5001" &&
        new URL(response.url()).pathname === "/demo-fitssai/europe-west3/nutritionUpdateSlot" &&
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(`"action":"${kind}"`)
    );

  // Replace breakfast with another breakfast of this plan: nutritionUpdateSlot on the emulator.
  await page.getByRole("button", { name: "Frühstück ersetzen" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: new RegExp(replacement) }).check();
  const committed = updateSlot("commit");
  await sheet.getByRole("button", { name: "Ersetzen", exact: true }).click();
  expect((await committed).status()).toBe(200);
  await expect(breakfast).toContainText(replacement);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toBeVisible();

  // Undo restores the base meal.
  await page.getByRole("button", { name: "Frühstück ersetzen" }).click();
  const undone = updateSlot("undo");
  await page.getByRole("dialog").getByRole("button", { name: "Rückgängig" }).click();
  expect((await undone).status()).toBe(200);
  await expect(breakfast).toContainText(original);
  await expect(breakfast.getByTestId("nutrition-v2-slot-replaced")).toHaveCount(0);

  expectEmulatorOnlyTraffic(network, { functions: true });
});

test("isolation account: its own plan, none of the adult's meals", async ({ page, context }) => {
  const network = await guardNetwork(context);
  const other = summary.users.isolation;
  await signIn(page, other.email, e2ePassword());
  await openNutrition(page);

  await expect(page.getByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "today");
  const rows = page.getByTestId("nutrition-v2-week-row");
  await expect(rows.first()).toHaveAttribute("data-plan-id", other.nutrition!.planId);
  const slots = page.getByTestId("nutrition-v2-slot");
  await expect(slots.first()).toContainText(other.nutrition!.meals[summary.today].breakfast);
  for (const name of Object.values(adultNutrition.meals[summary.today])) {
    await expect(page.getByText(name)).toHaveCount(0);
  }
  expectEmulatorOnlyTraffic(network, { functions: false });
});

test("the Functions emulator keeps Nutrition AI generation closed and writes nothing", async () => {
  const env = requireLocalEmulatorEnv(process.env);
  const token = await emulatorIdToken(env, adult.uid, adult.email, e2ePassword());

  const answer = await callEmulatorCallable(env, "nutritionRequestPlan", token, { requestId: "0e2e0000-0000-4000-8000-0000000000ff" });
  expect(answer.status).toBe(400);
  expect(answer.body).toEqual({ error: { message: "NUTRITION_AI_DISABLED", status: "FAILED_PRECONDITION" } });

  // No generation request, AI operation, AI log or quota was created by the run.
  expect(await listEmulatorDocumentIds(env, `users/${adult.uid}/nutrition_v2_generations`)).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_operations")).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_logs")).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_quota")).toEqual([]);
  const state = await getEmulatorDocument(env, `users/${adult.uid}/nutrition_v2_state/current`);
  expect(state?.activeGenerationRequestId).toEqual({ nullValue: null });
  expect(state?.activePlanId).toEqual({ stringValue: adultNutrition.planId });
});
