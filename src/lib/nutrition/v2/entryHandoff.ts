import type { NutritionDate, NutritionEntryIntent, RecordedEntry } from "@shared/nutrition";
import { OFFLINE_ENTRY_REPLAYED_EVENT } from "@/lib/offlineQueue";
import {
  NUTRITION_ENTRY_WRITE_TYPE,
  parseNutritionEntryWritePayload,
  unsettledHandoffIntents,
  type NutritionHandoffIntent,
} from "./nutritionWriteIntents";

/**
 * Nutrition entry intents the server has accepted but a server read may not
 * show yet (NUT-07): a queued intent that replay just wrote, or an online
 * write that just committed.
 *
 * Without this, a replayed intent leaves the queue — and with it the
 * optimistic overlay — one refetch before the server read shows it, and the
 * entry flickers back to the stale cache. So it is handed off here and keeps
 * projecting (through the same planner) until a read of its date no longer
 * needs it: the read shows it applied, or has moved past it.
 *
 * Module state, in memory only, scoped by account: another account never
 * sees these, and nothing here is a fake server document. Firestore- and
 * React-free.
 */

export interface NutritionHandoffItem extends NutritionHandoffIntent {
  ownerUid: string;
}

/** Tiny items; the bound only stops a very long session growing without end. */
const MAX_ITEMS = 200;

let items: NutritionHandoffItem[] = [];
let version = 0;
let listeners: (() => void)[] = [];

const notify = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

/** An intent the server accepted for `ownerUid`, to project until a read shows it. */
export const recordNutritionHandoff = (ownerUid: string, intent: NutritionEntryIntent, date: NutritionDate): void => {
  if (typeof ownerUid !== "string" || ownerUid.length === 0) return;
  if (items.some((item) => item.ownerUid === ownerUid && item.intent.intentId === intent.intentId)) return;
  items = [...items, { ownerUid, intent, date }].slice(-MAX_ITEMS);
  notify();
};

/** `ownerUid`'s handed-off intents, in the order the server accepted them. */
export const nutritionHandoffFor = (ownerUid: string | null | undefined): NutritionHandoffItem[] =>
  typeof ownerUid === "string" && ownerUid.length > 0 ? items.filter((item) => item.ownerUid === ownerUid) : [];

/**
 * Forget `ownerUid`'s intents that `committed` (a server read covering the
 * dates `covers` accepts) already settles.
 */
export const settleNutritionHandoff = (
  ownerUid: string,
  committed: readonly RecordedEntry[],
  covers: (date: NutritionDate) => boolean
): void => {
  const own = nutritionHandoffFor(ownerUid);
  if (own.length === 0) return;
  const keep = new Set(unsettledHandoffIntents({ committed, handoff: own, covers }));
  if (keep.size === own.length) return;
  items = items.filter((item) => item.ownerUid !== ownerUid || keep.has(item));
  notify();
};

export const subscribeNutritionHandoff = (listener: () => void): (() => void) => {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
};

export const getNutritionHandoffVersion = (): number => version;

/*
  Replay removed the entry because the server accepted it, and fires this
  before it invalidates the entry queries - so the handoff is in place before
  the refetch starts.
*/
if (typeof window !== "undefined") {
  window.addEventListener(OFFLINE_ENTRY_REPLAYED_EVENT, (event) => {
    const entry = (event as CustomEvent<unknown>).detail as { type?: unknown; ownerUid?: unknown; payload?: unknown } | undefined;
    if (entry?.type !== NUTRITION_ENTRY_WRITE_TYPE || typeof entry.ownerUid !== "string") return;
    const payload = parseNutritionEntryWritePayload(entry.payload);
    if (payload) recordNutritionHandoff(entry.ownerUid, payload.intent, payload.date);
  });
}

/** Test isolation only: forgets every handed-off intent. */
export const resetNutritionHandoffForTests = (): void => {
  items = [];
  notify();
};
