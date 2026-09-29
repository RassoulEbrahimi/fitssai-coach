import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Page, Request } from "@playwright/test";
import { e2ePassword, openNutrition, signIn } from "../support/browser";
import { callEmulatorCallable, emulatorIdToken, listEmulatorDocumentIds } from "../support/emulatorRest";
import { expect, test } from "../support/fixtures";
import { recordPlannedMeal, slotRow } from "../support/nutritionUi";
import { E2E_LOCAL_DIR } from "../support/processEnv";

/**
 * NUT-14 — the Nutrition TARGET setup and the explicit plan-generation action,
 * offered only while the DEPLOYED backend's `coachBackendStatus` says so.
 *
 * The Functions emulator runs this branch's source, so its live status is the
 * post-deploy one (targets and generation true). The release-order window —
 * the new frontend against a backend that still says false — is the same
 * status answered false at the browser boundary.
 *
 * Target setup runs for real: `nutritionSetTarget` is deterministic and
 * AI-free. Generation NEVER reaches the emulator's generator: every
 * `nutritionRequestPlan` the browser sends is answered at the browser
 * boundary (`page.route`), so no test here, or anywhere in this harness, makes
 * a Vertex AI call. The first real generation is the production smoke test.
 */

const SCREENSHOTS = path.join(E2E_LOCAL_DIR, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const GENERATE = /^(Ernährungsplan erstellen|Neuen Plan erstellen)$/;

const corsHeaders = (request: Request) => ({
  "access-control-allow-origin": request.headers().origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-firebase-appcheck, x-client-version, x-firebase-gmpid",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
});

/** Answer one callable at the browser boundary; every request body that reached it is kept. */
const answerCallable = async (page: Page, name: string, status: number, body: unknown): Promise<unknown[]> => {
  const bodies: unknown[] = [];
  await page.route(`**/${name}`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(request) });
      return;
    }
    bodies.push(request.postDataJSON());
    await route.fulfill({ status, headers: corsHeaders(request), body: JSON.stringify(body) });
  });
  return bodies;
};

const backendStatus = (uid: string, nutritionTargets: boolean, nutritionGeneration: boolean) => ({
  result: {
    ok: true,
    backend: "fitssai-coach",
    region: "europe-west3",
    uid,
    capabilities: { planGeneration: true, weeklySummaryAI: true, nutritionTargets, nutritionGeneration },
  },
});

const refusal = (message: string) => ({ error: { message, status: "FAILED_PRECONDITION" } });

test("release order: against a backend that still says false, no new action is shown and Nutrition keeps working", async ({
  page,
  seed,
  persisted,
}) => {
  const adult = seed.users.adult;
  const statusBodies = await answerCallable(page, "coachBackendStatus", 200, backendStatus(adult.uid, false, false));
  const generation = await answerCallable(page, "nutritionRequestPlan", 400, refusal("INTERNAL"));

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await expect(page.getByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "today");
  await expect(page.getByTestId("nutrition-v2-target-values")).toBeVisible();
  await expect.poll(() => statusBodies.length).toBe(1);

  await expect(page.getByRole("button", { name: /^Ziel (festlegen|ändern|prüfen)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);

  // Recording, the existing read/record path, still works.
  await recordPlannedMeal(page, "breakfast");
  await expect(slotRow(page, "breakfast").getByRole("button", { name: "Frühstück bearbeiten" })).toBeVisible();
  await expect.poll(async () => Object.keys((await persisted(adult.uid)).entries)).toHaveLength(1);

  // A refresh reads again and still offers nothing new.
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await expect.poll(() => statusBodies.length).toBe(2);
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);
  expect(generation).toEqual([]);
});

test("the live backend: a complete adult without a target sets one for real, and then generation is offered", async ({
  page,
  seed,
  env,
  adminDb,
  persisted,
}) => {
  // The missing-age account, now with its age: a complete adult profile without any Nutrition V2 data.
  const user = seed.users.missingAge;
  await adminDb.collection("users").doc(user.uid).update({ age: 31 });
  const generation = await answerCallable(page, "nutritionRequestPlan", 400, refusal("NUTRITION_AI_DISABLED"));

  await signIn(page, user.email, e2ePassword());
  await openNutrition(page);
  const card = page.getByTestId("nutrition-v2-today");
  await expect(card).toHaveAttribute("data-view", "notInitialized");
  await expect(page.getByText(/Als Nächstes legst du dein Ernährungsziel fest/)).toBeVisible();
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);

  // The existing setup sheet and the real deterministic `nutritionSetTarget`.
  await page.getByRole("button", { name: "Ziel festlegen" }).click();
  const sheet = page.getByRole("dialog", { name: "Ziel festlegen" });
  await sheet.getByRole("button", { name: "Berechnen" }).click();
  await sheet.getByRole("button", { name: "Ziel festlegen" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("nutrition-v2-target-values")).toBeVisible();

  const stored = await persisted(user.uid);
  expect(Object.keys(stored.targets)).toHaveLength(1);
  expect(stored.state?.currentTargetVersionId).toBe(Object.keys(stored.targets)[0]);
  expect(stored.plans).toEqual({});

  // Now — and only now — generation is offered. It is sent once, as { requestId }.
  const action = page.getByRole("button", { name: "Ernährungsplan erstellen" });
  await expect(action).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "nut14-target-then-generation.png"), fullPage: true });
  await action.click();
  await expect(page.getByTestId("nutrition-v2-generation-outcome")).toHaveText(
    "Die Planerstellung ist vorübergehend nicht verfügbar. Bitte versuche es später noch einmal."
  );
  expect(generation).toHaveLength(1);
  expect(Object.keys((generation[0] as { data: object }).data)).toEqual(["requestId"]);

  // The emulator's generator was never reached.
  expect(await listEmulatorDocumentIds(env, `users/${user.uid}/nutrition_v2_generations`)).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_operations")).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_quota")).toEqual([]);
});

test("the live backend: an adult with a plan regenerates only after confirming, once, and a refusal is said as product copy", async ({
  page,
  seed,
  env,
}) => {
  const adult = seed.users.adult;
  const generation = await answerCallable(page, "nutritionRequestPlan", 400, refusal("QUOTA_EXCEEDED"));

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await expect(page.getByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "today");
  await expect(page.getByRole("button", { name: "Ziel ändern" })).toBeVisible();
  const section = page.getByTestId("nutrition-v2-generation");
  await expect(section).toHaveAttribute("data-generation-kind", "regenerate");

  await section.getByRole("button", { name: "Neuen Plan erstellen" }).click();
  await expect(section).toHaveAttribute("data-generation", "confirming");
  await section.getByRole("button", { name: "Abbrechen" }).click();
  expect(generation).toEqual([]);

  await section.getByRole("button", { name: "Neuen Plan erstellen" }).click();
  await section.getByRole("button", { name: "Neuen Plan erstellen" }).click();
  await expect(page.getByTestId("nutrition-v2-generation-outcome")).toHaveText(
    "Du hast die Anzahl neuer Ernährungspläne für diesen Monat erreicht. Im nächsten Monat kannst du wieder neue Pläne erstellen."
  );
  expect(generation).toHaveLength(1);
  expect(Object.keys((generation[0] as { data: object }).data)).toEqual(["requestId"]);

  // A reload asks the live status again and starts nothing.
  await page.reload();
  await expect(page.getByTestId("nutrition-v2-generation")).toHaveAttribute("data-generation-kind", "regenerate");
  expect(generation).toHaveLength(1);
  expect(await listEmulatorDocumentIds(env, `users/${adult.uid}/nutrition_v2_generations`)).toEqual([]);
});

test("keto: the product says generation does not support it, and the emulator refuses it before any provider work", async ({
  page,
  seed,
  env,
  adminDb,
}) => {
  const adult = seed.users.adult;
  await adminDb.collection("users").doc(adult.uid).update({ dietaryPreference: "keto" });

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  await expect(page.getByText("Für die Ernährungsform Keto können derzeit keine Ernährungspläne erstellt werden.")).toBeVisible();
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);

  // The server's own answer, with the AI gate on: refused after eligibility, before the provider.
  const token = await emulatorIdToken(env, adult.uid, adult.email, e2ePassword());
  const answer = await callEmulatorCallable(env, "nutritionRequestPlan", token, { requestId: randomUUID() });
  expect(answer).toEqual({ status: 400, body: refusal("DIETARY_PREFERENCE_NOT_SUPPORTED") });
  expect(await listEmulatorDocumentIds(env, `users/${adult.uid}/nutrition_v2_generations`)).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_operations")).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_quota")).toEqual([]);
});
