import { nutritionEntryIntentSchema } from "../../shared/nutrition";
import { e2ePassword, openNutrition, signIn } from "../support/browser";
import { expect, test } from "../support/fixtures";
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  documentMarked,
  markDocument,
  openReplaceSheet,
  readOfflineQueue,
  recordPlannedMeal,
  slotRow,
} from "../support/nutritionUi";

/**
 * NUT-13B §5 — offline → online recording reconciliation (NUT-07), in the real
 * app: the browser context is taken offline with Playwright's
 * `context.setOffline`, which in Chromium cuts every request AND reports
 * `navigator.onLine === false` with the `offline`/`online` events the app
 * listens to, so no helper around the product is needed.
 *
 * One explicit action is ONE intent: queued with its id while offline, replayed
 * with the same id when online, applied once. Replaying it again — after more
 * network transitions, or when a replay's queue cleanup was interrupted and the
 * entry is still stored — is `alreadyApplied`, never a second revision.
 */

const MARKER = "__nut13bOffline";

test("offline recording is queued as one intent, replayed once on reconnect, and never duplicated", async ({
  page,
  context,
  seed,
  persisted,
}) => {
  const adult = seed.users.adult;
  const nutrition = adult.nutrition!;
  const entryId = `slot:${seed.today}:breakfast`;
  const breakfast = slotRow(page, "breakfast");

  await signIn(page, adult.email, e2ePassword());
  await openNutrition(page);
  // The committed state this device needs: today's plan and the (empty) entries read.
  await expect(breakfast).toContainText(nutrition.meals[seed.today].breakfast);
  await expect(breakfast).toHaveAttribute("data-recorded", "none");
  await markDocument(page, MARKER);

  // OFFLINE.
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByTestId("nutrition-v2-offline-note")).toBeVisible();

  await recordPlannedMeal(page, "breakfast");

  // UI: shown as recorded on this device, and truthfully as waiting to synchronise — never as saved.
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(breakfast.getByTestId("nutrition-v2-pending")).toHaveText("Lokal gespeichert – wird synchronisiert");
  await expect(breakfast.getByTestId("nutrition-v2-pending")).toHaveAttribute("data-pending-status", "pending");

  // Device: exactly one queued intent for this action, owned by this account.
  const queued = await readOfflineQueue(page);
  expect(queued).toHaveLength(1);
  const [entry] = queued;
  expect(entry).toMatchObject({ ownerUid: adult.uid, type: "NUTRITION_ENTRY_WRITE", status: "pending", payload: { date: seed.today } });
  const intent = nutritionEntryIntentSchema.parse(entry.payload.intent);
  expect(intent).toMatchObject({ op: "record", entryId, expectedRevision: 0 });
  if (intent.op !== "record") throw new Error("expected a record intent");
  // Server: nothing committed.
  expect((await persisted(adult.uid)).entries).toEqual({});

  // Replacement needs the server: offline it is blocked, for the queued slot and for any other.
  const blockedPending = await openReplaceSheet(page, "breakfast");
  await expect(blockedPending.getByTestId("nutrition-v2-replace-blocked")).toBeVisible();
  await expect(blockedPending.getByRole("button", { name: "Ersetzen", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(blockedPending).toBeHidden();
  const blockedOffline = await openReplaceSheet(page, "lunch");
  await expect(blockedOffline.getByTestId("nutrition-v2-replace-blocked")).toHaveText("Ersetzen ist nur mit Internetverbindung möglich.");
  await page.keyboard.press("Escape");
  await expect(blockedOffline).toBeHidden();

  // Longer than the queue's 5 s retry interval: offline, nothing is attempted.
  await page.waitForTimeout(6_000);
  expect(await readOfflineQueue(page)).toEqual(queued);
  expect((await persisted(adult.uid)).entries).toEqual({});

  // ONLINE: the app's own replay runs on the `online` event.
  await context.setOffline(false);
  await expect.poll(async () => (await readOfflineQueue(page)).length, { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => Object.keys((await persisted(adult.uid)).entries), { timeout: 20_000 }).toEqual([entryId]);
  const committed = (await persisted(adult.uid)).entries[entryId];
  // The SAME intent, applied once.
  expect(committed).toMatchObject({ recording: "plannedMeal", name: nutrition.meals[seed.today].breakfast, revision: 1, status: "active" });
  expect(committed.appliedIntentIds).toEqual([intent.intentId]);
  // What was written is exactly the snapshot the queued intent carried.
  const { revision, status, appliedIntentIds, ...snapshot } = committed;
  void [revision, status, appliedIntentIds];
  expect(snapshot).toEqual(intent.desired);
  await expect(breakfast.getByTestId("nutrition-v2-pending")).toHaveCount(0);
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");

  // More transitions: offline, online, and past the retry interval. Nothing more is written.
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await page.waitForTimeout(6_000);
  expect((await persisted(adult.uid)).entries).toEqual({ [entryId]: committed });

  // A replay whose queue cleanup was interrupted: the same stored entry is back in the queue.
  // Replaying the same intent again is `alreadyApplied` — the entry leaves the queue, the server is unchanged.
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), {
    key: OFFLINE_QUEUE_STORAGE_KEY,
    stored: queued,
  });
  expect(await readOfflineQueue(page)).toHaveLength(1);
  await expect.poll(async () => (await readOfflineQueue(page)).length, { timeout: 20_000 }).toBe(0);
  expect((await persisted(adult.uid)).entries).toEqual({ [entryId]: committed });

  // The whole flow ran in one document: no reload hid a lost in-memory state.
  expect(await documentMarked(page, MARKER)).toBe(true);

  // Immediate reload: the committed result, nothing pending, nothing queued.
  await page.reload();
  await expect(breakfast).toHaveAttribute("data-recorded", "plannedMeal");
  await expect(breakfast.getByTestId("nutrition-v2-pending")).toHaveCount(0);
  expect(await readOfflineQueue(page)).toEqual([]);
  expect((await persisted(adult.uid)).entries).toEqual({ [entryId]: committed });
});
