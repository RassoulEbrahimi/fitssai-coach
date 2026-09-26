/*
  Nutrition V2 recorded-entry documents exactly as the client writes them
  (NUT-06), for the Firestore rules tests.

  Plain data with no imports: the rules job installs only this workspace, so
  it cannot load the shared zod contract or the planner. The client suite
  closes that gap instead — src/lib/nutrition/v2/entryRulesFixtures.test.ts
  parses every valid document here with the canonical `recordedEntrySchema`
  and checks that the shared planner produces every transition here, byte for
  byte. A document the rules accept is therefore one the app really writes.
*/

export const DATE = "2026-09-26";
export const PLAN_ID = "plan-1";
export const EXTRA_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Distinct lower-case v4 UUIDs, as `crypto.randomUUID()` produces them. */
export const intentId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type EntryDoc = Record<string, unknown> & {
  entryId: string;
  revision: number;
  status: string;
  appliedIntentIds: string[];
};

const meta = (intent = intentId(1)) => ({ revision: 1, status: "active", appliedIntentIds: [intent] });

export const plannedMealDoc = (): EntryDoc => ({
  schemaVersion: 2,
  entryId: `slot:${DATE}:lunch`,
  kind: "slot",
  date: DATE,
  slotId: "lunch",
  recording: "plannedMeal",
  planId: PLAN_ID,
  name: "Linsen-Curry",
  estimateBasis: "planMealTimesPortion",
  portion: 1.5,
  // 700.2 kcal · 40 g · 80 g · 20 g planned, times 1.5 — unrounded.
  nutritionEstimate: { kcal: 700.2 * 1.5, proteinG: 60, carbsG: 120, fatG: 30 },
  ...meta(),
});

export const skipDoc = (): EntryDoc => ({
  schemaVersion: 2,
  entryId: `slot:${DATE}:breakfast`,
  kind: "slot",
  date: DATE,
  slotId: "breakfast",
  recording: "skip",
  estimateBasis: "none",
  nutritionEstimate: null,
  ...meta(),
});

export const customSlotDoc = (): EntryDoc => ({
  schemaVersion: 2,
  entryId: `slot:${DATE}:dinner`,
  kind: "slot",
  date: DATE,
  slotId: "dinner",
  recording: "custom",
  name: "Pizza beim Italiener",
  estimateBasis: "userStated",
  // Unknown macros are null, never zero.
  nutritionEstimate: { kcal: 950, proteinG: null, carbsG: 110, fatG: null },
  ...meta(),
});

export const extraDoc = (): EntryDoc => ({
  schemaVersion: 2,
  entryId: `extra:${EXTRA_UUID}`,
  kind: "extra",
  date: DATE,
  slotId: null,
  recording: "custom",
  name: "Apfel",
  estimateBasis: "userStated",
  nutritionEstimate: { kcal: 80, proteinG: null, carbsG: null, fatG: null },
  ...meta(),
});

export const VALID_CREATES: ReadonlyArray<readonly [string, () => EntryDoc]> = [
  ["slot plannedMeal", plannedMealDoc],
  ["slot skip", skipDoc],
  ["slot custom", customSlotDoc],
  ["extra custom", extraDoc],
];

/** The semantic part of a document: what a recording action states, without metadata. */
const semantic = (doc: EntryDoc): Record<string, unknown> => {
  const { revision: _revision, status: _status, appliedIntentIds: _ids, ...rest } = doc;
  return rest;
};

/**
 * The document after one applied write: the desired semantic state (or, for a
 * removal, the previous snapshot), revision +1, the intent appended to the
 * ring and the oldest id dropped past 20.
 */
export const nextDoc = (
  prev: EntryDoc,
  intent: string,
  change: { desired?: EntryDoc; status?: "active" | "removed" } = {}
): EntryDoc =>
  ({
    ...(change.desired ? semantic(change.desired) : semantic(prev)),
    revision: prev.revision + 1,
    status: change.status ?? "active",
    appliedIntentIds: [...prev.appliedIntentIds, intent].slice(-20),
  }) as EntryDoc;

/** A document whose ring already holds `size` intents (ids 101…), at revision `size`. */
export const withRing = (doc: EntryDoc, size: number): EntryDoc => ({
  ...doc,
  revision: size,
  appliedIntentIds: Array.from({ length: size }, (_, i) => intentId(101 + i)),
});

/** The eaten lunch, corrected to half a portion. */
export const halfPortionLunch = (): EntryDoc => ({
  ...plannedMealDoc(),
  portion: 0.5,
  nutritionEstimate: { kcal: 700.2 * 0.5, proteinG: 20, carbsG: 40, fatG: 10 },
});

/** The lunch slot, recorded as something else. */
export const customLunch = (): EntryDoc => ({
  ...customSlotDoc(),
  entryId: `slot:${DATE}:lunch`,
  slotId: "lunch",
  name: "Kantinenessen",
});

/** The lunch slot, explicitly skipped. */
export const skippedLunch = (): EntryDoc => ({ ...skipDoc(), entryId: `slot:${DATE}:lunch`, slotId: "lunch" });

/**
 * Transitions the shared planner produces and the rules accept. `intent` is
 * the planner input apart from `desired`, which is `next` without metadata.
 */
export interface EntryTransition {
  name: string;
  prev: EntryDoc | null;
  intent: { intentId: string; op: "record" | "skip" | "correct" | "remove"; expectedRevision: number };
  next: EntryDoc;
}

const removedLunch = (): EntryDoc => nextDoc(plannedMealDoc(), intentId(2), { status: "removed" });

export const ACCEPTED_TRANSITIONS: readonly EntryTransition[] = [
  {
    name: "create a planned-meal recording",
    prev: null,
    intent: { intentId: intentId(1), op: "record", expectedRevision: 0 },
    next: plannedMealDoc(),
  },
  {
    name: "create a skip",
    prev: null,
    intent: { intentId: intentId(1), op: "skip", expectedRevision: 0 },
    next: skipDoc(),
  },
  {
    name: "create an extra",
    prev: null,
    intent: { intentId: intentId(1), op: "record", expectedRevision: 0 },
    next: extraDoc(),
  },
  {
    name: "correct the portion",
    prev: plannedMealDoc(),
    intent: { intentId: intentId(2), op: "correct", expectedRevision: 1 },
    next: nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }),
  },
  {
    name: "correct a planned meal to something else",
    prev: plannedMealDoc(),
    intent: { intentId: intentId(2), op: "correct", expectedRevision: 1 },
    next: nextDoc(plannedMealDoc(), intentId(2), { desired: customLunch() }),
  },
  {
    name: "correct a planned meal to a skip",
    prev: plannedMealDoc(),
    intent: { intentId: intentId(2), op: "correct", expectedRevision: 1 },
    next: nextDoc(plannedMealDoc(), intentId(2), { desired: skippedLunch() }),
  },
  {
    name: "correct an extra",
    prev: extraDoc(),
    intent: { intentId: intentId(2), op: "correct", expectedRevision: 1 },
    next: nextDoc(extraDoc(), intentId(2), { desired: { ...extraDoc(), name: "Zwei Äpfel", nutritionEstimate: { kcal: 160, proteinG: 1, carbsG: null, fatG: null } } }),
  },
  {
    name: "remove an active entry (tombstone)",
    prev: plannedMealDoc(),
    intent: { intentId: intentId(2), op: "remove", expectedRevision: 1 },
    next: removedLunch(),
  },
  {
    name: "remove an extra (tombstone)",
    prev: extraDoc(),
    intent: { intentId: intentId(2), op: "remove", expectedRevision: 1 },
    next: nextDoc(extraDoc(), intentId(2), { status: "removed" }),
  },
  {
    name: "record a tombstoned slot again",
    prev: removedLunch(),
    intent: { intentId: intentId(3), op: "record", expectedRevision: 2 },
    next: nextDoc(removedLunch(), intentId(3), { desired: customLunch() }),
  },
  {
    name: "skip a tombstoned slot",
    prev: removedLunch(),
    intent: { intentId: intentId(3), op: "skip", expectedRevision: 2 },
    next: nextDoc(removedLunch(), intentId(3), { desired: skippedLunch() }),
  },
  {
    name: "grow the intent ring to 20",
    prev: withRing(plannedMealDoc(), 19),
    intent: { intentId: intentId(1), op: "correct", expectedRevision: 19 },
    next: nextDoc(withRing(plannedMealDoc(), 19), intentId(1), { desired: halfPortionLunch() }),
  },
  {
    name: "evict the oldest intent id past 20",
    prev: withRing(plannedMealDoc(), 20),
    intent: { intentId: intentId(1), op: "correct", expectedRevision: 20 },
    next: nextDoc(withRing(plannedMealDoc(), 20), intentId(1), { desired: halfPortionLunch() }),
  },
];
