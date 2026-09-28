import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { E2E_EMULATOR_PORTS, E2E_FUNCTIONS_REGION, E2E_PROJECT_ID } from "./emulatorEnv";

/**
 * The Nutrition V2 screen as a person uses it: the app's own buttons, sheets
 * and accessible names, nothing driven around the UI. Shared by the NUT-13B
 * scenarios; no page objects.
 */

export type E2ESlotId = "breakfast" | "lunch" | "dinner";

export const SLOT_LABELS: Record<E2ESlotId, string> = { breakfast: "Frühstück", lunch: "Mittagessen", dinner: "Abendessen" };

/** Where the offline queue lives on the device (src/lib/offlineQueue.ts). */
export const OFFLINE_QUEUE_STORAGE_KEY = "FITSSAI_OFFLINE_QUEUE";

export const slotRow = (page: Page, slotId: E2ESlotId): Locator =>
  page.locator(`[data-testid="nutrition-v2-slot"][data-slot-id="${slotId}"]`);

export const weekRow = (page: Page, date: string): Locator =>
  page.locator(`[data-testid="nutrition-v2-week-row"][data-date="${date}"]`);

/** The open bottom sheet (Radix dialog). */
export const openSheet = (page: Page): Locator => page.getByRole("dialog");

/** Open a slot's recording sheet. */
export const openRecordingSheet = async (page: Page, slotId: E2ESlotId): Promise<Locator> => {
  await slotRow(page, slotId).getByRole("button", { name: `${SLOT_LABELS[slotId]} erfassen` }).click();
  const sheet = openSheet(page);
  await expect(sheet.getByRole("heading", { name: `${SLOT_LABELS[slotId]} erfassen` })).toBeVisible();
  return sheet;
};

/** Record the slot's planned meal, portion 1, through the recording sheet. */
export const recordPlannedMeal = async (page: Page, slotId: E2ESlotId) => {
  const sheet = await openRecordingSheet(page, slotId);
  await expect(sheet.getByRole("button", { name: "Gegessen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(sheet).toBeHidden();
};

/** Remove a slot's active recording (a tombstone) through the recording sheet. */
export const removeRecording = async (page: Page, slotId: E2ESlotId) => {
  await slotRow(page, slotId).getByRole("button", { name: `${SLOT_LABELS[slotId]} bearbeiten` }).click();
  const sheet = openSheet(page);
  await sheet.getByRole("button", { name: "Entfernen" }).click();
  await expect(sheet).toBeHidden();
};

/** Open a slot's replacement sheet. */
export const openReplaceSheet = async (page: Page, slotId: E2ESlotId): Promise<Locator> => {
  await page.getByRole("button", { name: `${SLOT_LABELS[slotId]} ersetzen` }).click();
  const sheet = openSheet(page);
  await expect(sheet.getByRole("heading", { name: `${SLOT_LABELS[slotId]} ersetzen` })).toBeVisible();
  return sheet;
};

/** The answer of the next `nutritionUpdateSlot` call with `action`, on the Functions emulator. */
export const nextUpdateSlotResponse = (page: Page, action: "commit" | "undo"): Promise<Response> =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.port === String(E2E_EMULATOR_PORTS.functions) &&
      url.pathname === `/${E2E_PROJECT_ID}/${E2E_FUNCTIONS_REGION}/nutritionUpdateSlot` &&
      response.request().method() === "POST" &&
      (response.request().postData() ?? "").includes(`"action":"${action}"`)
    );
  });

/** Replace a slot's planned meal with another meal of the plan; resolves once the server answered 200. */
export const replaceSlot = async (page: Page, slotId: E2ESlotId, mealName: string) => {
  const sheet = await openReplaceSheet(page, slotId);
  await sheet.getByRole("radio", { name: new RegExp(`^${escapeRegExp(mealName)} ·`) }).check();
  const committed = nextUpdateSlotResponse(page, "commit");
  await sheet.getByRole("button", { name: "Ersetzen", exact: true }).click();
  expect((await committed).status()).toBe(200);
  await expect(sheet).toBeHidden();
};

/** Undo a slot's replacement; resolves once the server answered 200. */
export const undoSlot = async (page: Page, slotId: E2ESlotId) => {
  const sheet = await openReplaceSheet(page, slotId);
  const undone = nextUpdateSlotResponse(page, "undo");
  await sheet.getByRole("button", { name: "Rückgängig" }).click();
  expect((await undone).status()).toBe(200);
  await expect(sheet).toBeHidden();
};

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The bottom navigation, and one of its tabs. */
export const bottomNav = (page: Page): Locator => page.getByRole("navigation", { name: "Hauptnavigation" });

export const navigateWithBottomNav = async (page: Page, tab: "Ernährungsplan" | "Profil" | "Dashboard" | "Trainingsplan") => {
  await bottomNav(page).getByRole("button", { name: tab }).click();
  await expect(bottomNav(page).getByRole("button", { name: tab })).toHaveAttribute("aria-current", "page");
};

/** The offline queue exactly as stored on this device. */
export interface StoredQueueEntry {
  id: string;
  ownerUid: string;
  type: string;
  status: string;
  payload: { intent?: { intentId?: string; entryId?: string; op?: string }; date?: string };
}

export const readOfflineQueue = async (page: Page): Promise<StoredQueueEntry[]> =>
  JSON.parse((await page.evaluate((key) => localStorage.getItem(key), OFFLINE_QUEUE_STORAGE_KEY)) ?? "[]");

/**
 * Reload the page bypassing the HTTP cache (Chrome's hard reload), through
 * the DevTools protocol of the test's own browser.
 */
export const hardReload = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  const loaded = page.waitForEvent("load");
  await session.send("Page.reload", { ignoreCache: true });
  await loaded;
  await session.detach();
};

/**
 * A marker on `window`: it survives client-side navigation and is gone after
 * any reload, so a test can prove it stayed in one document.
 */
export const markDocument = (page: Page, marker: string) =>
  page.evaluate((name) => {
    (window as unknown as Record<string, unknown>)[name] = true;
  }, marker);

export const documentMarked = (page: Page, marker: string): Promise<boolean> =>
  page.evaluate((name) => (window as unknown as Record<string, unknown>)[name] === true, marker);

/** The account's persisted React Query cache (src/components/providers/QueryProvider.tsx). */
export const persistedQueryCacheKey = (uid: string) => `REACT_QUERY_OFFLINE_CACHE:${encodeURIComponent(uid)}`;

export interface PersistedRead {
  key: string;
  data: unknown;
  dataUpdatedAt: number;
}

/** Every read in this device's persisted query cache for `uid`, as stored. */
export const persistedQueryReads = async (page: Page, uid: string): Promise<(PersistedRead & { queryKey: unknown[] })[]> =>
  page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const queries = (JSON.parse(raw) as { clientState: { queries: { queryKey: unknown[]; state: { data?: unknown; dataUpdatedAt: number } }[] } })
      .clientState.queries;
    return queries.map((query) => ({
      queryKey: query.queryKey,
      key: JSON.stringify(query.queryKey),
      data: query.state.data ?? null,
      dataUpdatedAt: query.state.dataUpdatedAt,
    }));
  }, persistedQueryCacheKey(uid));

/** This device's persisted Nutrition V2 reads of one family (`entries`, `slots`, ...). */
export const persistedNutritionReads = async (page: Page, uid: string, family: string): Promise<PersistedRead[]> =>
  (await persistedQueryReads(page, uid))
    .filter((read) => read.queryKey[0] === "nutrition-v2" && read.queryKey[2] === family)
    .map(({ key, data, dataUpdatedAt }) => ({ key, data, dataUpdatedAt }));

/** The persisted profile read (`['profile', uid]`), or null. */
export const persistedProfileRead = async (page: Page, uid: string): Promise<PersistedRead | null> =>
  (await persistedQueryReads(page, uid)).find((read) => read.queryKey[0] === "profile" && read.queryKey[1] === uid) ?? null;

/** The entry ids each persisted entries read holds. */
export const persistedEntryReads = async (page: Page, uid: string) =>
  (await persistedNutritionReads(page, uid, "entries")).map((read) => ({
    key: read.key,
    entryIds: Array.isArray(read.data) ? read.data.map((entry: { entryId: string }) => entry.entryId) : [],
    dataUpdatedAt: read.dataUpdatedAt,
  }));

/**
 * Wait until this device's persisted entries reads hold `entryIds` (and only
 * those). The persister writes at most once a second (flushed when the page
 * is hidden or left, NUT-13B-FIX-01); `nutrition-reload-cache.e2e.ts` uses
 * this to know the stored read before it races a reload against that window.
 */
export const waitForPersistedEntries = async (page: Page, uid: string, entryIds: string[]) => {
  await expect
    .poll(async () => (await persistedEntryReads(page, uid)).map((read) => [...read.entryIds].sort()), { timeout: 10_000 })
    .toContainEqual([...entryIds].sort());
};

/** A slot head as the client read it, the parts the scenarios compare. */
export interface PersistedSlotHead {
  date: string;
  slotId: string;
  revision: number;
  selection: { kind: string; overrideId?: string };
}

/** The same wait for slot heads: some persisted slot-heads read of the plan equals `expected`. */
export const waitForPersistedSlotHeads = async (page: Page, uid: string, expected: PersistedSlotHead[]) => {
  const summary = (heads: PersistedSlotHead[]) =>
    heads
      .map((head) => `${head.date}/${head.slotId}@${head.revision}:${head.selection.kind}:${head.selection.overrideId ?? ""}`)
      .sort()
      .join(",");
  await expect
    .poll(
      async () =>
        (await persistedNutritionReads(page, uid, "slots")).map((read) => summary(Array.isArray(read.data) ? (read.data as PersistedSlotHead[]) : [])),
      { timeout: 10_000 }
    )
    .toContainEqual(summary(expected));
};
