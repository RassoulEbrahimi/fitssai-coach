import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { recordedEntrySchema } from "../../shared/nutrition";
import { e2ePassword, openNutrition, signIn } from "../support/browser";
import { callEmulatorCallable, createEmulatorDocumentAs, emulatorIdToken, listEmulatorDocumentIds } from "../support/emulatorRest";
import { expect, test } from "../support/fixtures";
import type { LocalEmulatorEnv } from "../support/emulatorEnv";
import type { NutritionSeedSummary } from "../support/seedNutrition";

/**
 * NUT-13B §7 — eligibility boundaries (NUT-03) on the seeded missing-age and
 * minor accounts, in the browser and on the server.
 *
 * Neither account has V2 data, and none is seeded for them. The browser must
 * not even read Nutrition V2 for an ineligible account, must offer no
 * recording or replacement, and the server refuses target, slot and entry
 * mutations on eligibility alone — independent of the closed AI gate.
 */

/** Every browser request that names a Nutrition V2 collection (Firestore reads and writes). */
const trackNutritionV2Requests = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (request) => {
    const text = `${request.url()} ${request.postData() ?? ""}`;
    if (text.includes("nutrition_v2")) seen.push(`${request.method()} ${request.url().split("?")[0]}`);
  });
  return seen;
};

/** No V2 data, no recording, no replacement anywhere on the Nutrition screen. */
const expectNoNutritionV2Surface = async (page: Page) => {
  await expect(page.getByTestId("nutrition-v2-target")).toHaveCount(0);
  await expect(page.getByTestId("nutrition-v2-slot")).toHaveCount(0);
  await expect(page.getByTestId("nutrition-v2-week-row")).toHaveCount(0);
  await expect(page.getByTestId("nutrition-v2-today-recording")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /erfassen$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ersetzen$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aktualisieren" })).toHaveCount(0);
  // NUT-14: neither the target setup nor plan generation, whatever the backend offers.
  await expect(page.getByRole("button", { name: /^Ziel (festlegen|ändern|prüfen)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ernährungsplan erstellen|Neuen Plan erstellen/ })).toHaveCount(0);
};

/** The server refuses every Nutrition V2 mutation of `key` with NOT_ELIGIBLE / the rules. */
const expectServerRefusesMutations = async (
  env: LocalEmulatorEnv,
  seed: NutritionSeedSummary,
  key: "missingAge" | "minor",
  reason: "missingAge" | "minor"
) => {
  const user = seed.users[key];
  const token = await emulatorIdToken(env, user.uid, user.email, e2ePassword());
  const notEligible = { error: { message: "NOT_ELIGIBLE", status: "PERMISSION_DENIED", details: { reason } } };

  const target = await callEmulatorCallable(env, "nutritionSetTarget", token, { mode: "calculated", requestId: randomUUID() });
  expect(target).toEqual({ status: 403, body: notEligible });

  // Eligibility is read before the plan inside the transaction: the adult's real plan address does not help.
  const slot = await callEmulatorCallable(env, "nutritionUpdateSlot", token, {
    action: "commit",
    requestId: randomUUID(),
    planId: seed.users.adult.nutrition!.planId,
    date: seed.today,
    slotId: "breakfast",
    expectedRevision: 0,
    replacement: { source: "planMeal", sourceMealId: `${seed.users.adult.nutrition!.planId}-d5-breakfast` },
  });
  expect(slot).toEqual({ status: 403, body: notEligible });

  // NUT-14: with the AI gate on, generation is refused by eligibility itself —
  // before any provider work — and writes nothing.
  const generation = await callEmulatorCallable(env, "nutritionRequestPlan", token, { requestId: randomUUID() });
  expect(generation).toEqual({ status: 403, body: notEligible });
  expect(await listEmulatorDocumentIds(env, `users/${user.uid}/nutrition_v2_generations`)).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_operations")).toEqual([]);
  expect(await listEmulatorDocumentIds(env, "_ai_quota")).toEqual([]);

  // A recorded entry the rules accept for an adult (checked below) is denied for this account.
  const entry = skipEntry(seed.today);
  const denied = await createEmulatorDocumentAs(env, token, `users/${user.uid}/nutrition_v2_entries`, entry.entryId, entry);
  expect(denied.status).toBe(403);
  expect(JSON.stringify(denied.body)).toContain("PERMISSION_DENIED");
};

/** A valid skip entry for today's breakfast, as the client writes it (NUT-06). */
const skipEntry = (date: string) =>
  recordedEntrySchema.parse({
    schemaVersion: 2,
    entryId: `slot:${date}:breakfast`,
    kind: "slot",
    date,
    slotId: "breakfast",
    recording: "skip",
    estimateBasis: "none",
    nutritionEstimate: null,
    revision: 1,
    status: "active",
    appliedIntentIds: [randomUUID()],
  });

test("missing age: no V2 data or actions; the age can be completed and the account becomes eligible, intact", async ({
  page,
  seed,
  env,
  persisted,
}) => {
  const user = seed.users.missingAge;
  const before = await persisted(user.uid);
  expect(before.profile?.age).toBeUndefined();
  expect(before.collections).toEqual([]);
  await expectServerRefusesMutations(env, seed, "missingAge", "missingAge");

  const v2Requests = trackNutritionV2Requests(page);
  await signIn(page, user.email, e2ePassword());
  await openNutrition(page);
  const card = page.getByTestId("nutrition-v2-today");
  await expect(card).toHaveAttribute("data-view", "ineligible");
  await expectNoNutritionV2Surface(page);
  // The way in: the profile completion card, naming the age as open.
  const completion = page.getByTestId("nutrition-v2-profile-completion");
  await expect(completion).toHaveAttribute("data-profile-status", "incomplete");
  await expect(completion.getByTestId("nutrition-v2-profile-open-fields")).toHaveText("Noch offen: Alter");
  expect(v2Requests, "Nutrition V2 reads of an ineligible account").toEqual([]);

  // Complete the age through the sheet.
  await completion.getByRole("button", { name: "Angaben ergänzen" }).click();
  const sheet = page.getByTestId("nutrition-v2-profile-sheet");
  await expect(sheet.getByTestId("nutrition-v2-profile-age-open")).toBeVisible();
  // Out of range first: refused in the form, nothing saved.
  await sheet.getByLabel("Alter").fill("12");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(sheet).toBeVisible();
  expect((await persisted(user.uid)).profile?.age).toBeUndefined();
  await sheet.getByLabel("Alter").fill("30");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(sheet).toBeHidden();

  // Eligible now: no target or plan exists, so the complete profile is the empty state.
  await expect(card).not.toHaveAttribute("data-view", "ineligible");
  await expect(card).toHaveAttribute("data-view", "notInitialized");
  await expect(page.getByTestId("nutrition-v2-profile-completion")).toHaveAttribute("data-profile-status", "complete");
  await expect(page.getByText("Dein Ernährungsprofil ist vollständig.")).toBeVisible();
  await expect(page.getByTestId("nutrition-v2-slot")).toHaveCount(0);
  // NUT-14: the live emulator backend offers target setup, so it is the next
  // action; generation waits for a target. Nothing is set by showing it.
  await expect(page.getByText(/Als Nächstes legst du dein Ernährungsziel fest/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ziel festlegen" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ernährungsplan erstellen|Neuen Plan erstellen/ })).toHaveCount(0);

  // Server: the age, and nothing else, changed; no Nutrition V2 document was created.
  const after = await persisted(user.uid);
  expect(after.profile).toEqual({ ...before.profile, age: 30 });
  expect(after.collections).toEqual([]);
  expect(after.state).toBeNull();

  // Immediate reload: the saved server state, not the pre-save profile.
  await page.reload();
  await expect(card).toHaveAttribute("data-view", "notInitialized");
  await expect(page.getByTestId("nutrition-v2-profile-completion")).toHaveAttribute("data-profile-status", "complete");
});

test("minor: no V2 data read or shown, no recording, replacement, target or generation", async ({ page, seed, env, persisted }) => {
  const user = seed.users.minor;
  const before = await persisted(user.uid);
  expect(before.profile?.age).toBe(16);
  await expectServerRefusesMutations(env, seed, "minor", "minor");

  const v2Requests = trackNutritionV2Requests(page);
  await signIn(page, user.email, e2ePassword());
  await openNutrition(page);
  const card = page.getByTestId("nutrition-v2-today");
  await expect(card).toHaveAttribute("data-view", "ineligible");
  await expect(card.getByRole("heading", { name: "Ernährung ist ab 18 Jahren verfügbar" })).toBeVisible();
  await expectNoNutritionV2Surface(page);
  await page.reload();
  await expect(card).toHaveAttribute("data-view", "ineligible");
  await expectNoNutritionV2Surface(page);
  expect(v2Requests, "Nutrition V2 reads of a minor").toEqual([]);

  // Nothing was written anywhere for the minor.
  const after = await persisted(user.uid);
  expect(after.collections).toEqual([]);
  expect(after.profile).toEqual(before.profile);
});

test("control: the same entry the rules deny the minor and the missing-age account is accepted for the adult", async ({ seed, env, persisted }) => {
  const adult = seed.users.adult;
  const token = await emulatorIdToken(env, adult.uid, adult.email, e2ePassword());
  const entry = skipEntry(seed.today);
  const created = await createEmulatorDocumentAs(env, token, `users/${adult.uid}/nutrition_v2_entries`, entry.entryId, entry);
  expect(created.status).toBe(200);
  expect((await persisted(adult.uid)).entries[entry.entryId]).toEqual(entry);
});
