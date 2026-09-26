/**
 * Firestore collection names for Nutrition, in one place.
 *
 * Names only. Nothing here opens a reference, reads or writes: the readers and
 * writers that use these names arrive in later slices, and they take the name
 * from here instead of spelling the string again.
 */

/** Nutrition V2 collections. Every one is new; none is shared with legacy Nutrition. */
export const NUTRITION_V2_COLLECTIONS = Object.freeze({
  state: "nutrition_v2_state",
  targets: "nutrition_v2_targets",
  plans: "nutrition_v2_plans",
  slots: "nutrition_v2_slots",
  entries: "nutrition_v2_entries",
  generations: "nutrition_v2_generations",
} as const);

export type NutritionV2CollectionName =
  (typeof NUTRITION_V2_COLLECTIONS)[keyof typeof NUTRITION_V2_COLLECTIONS];

/** Server-only: slot suggestions are never read or written by the client. */
export const NUTRITION_V2_SUGGESTIONS_COLLECTION = "_nutrition_v2_suggestions" as const;

/** Legacy Nutrition's plans. Outside V2: named here only so V2 never reuses it. */
export const NUTRITION_LEGACY_PLANS_COLLECTION = "nutrition_plans" as const;
