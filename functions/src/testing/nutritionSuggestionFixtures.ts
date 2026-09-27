import type { Firestore } from "firebase-admin/firestore";
import type { NutritionDate, NutritionSlotId, ReplacementSuggestionSet } from "../../../shared/nutrition";
import { storeReplacementSuggestionSet } from "../nutrition/suggestionStore";

/**
 * TEST FIXTURES ONLY: deterministic replacement suggestion sets for the NUT-10
 * slot tests. Nothing here is generated, and nothing here is a suggestion
 * anyone would eat: names and values are arbitrary and mean nothing, the
 * validation provenance names a fixture policy that is not a FitssAI rule, and
 * the lifetime is whatever instant a test passes — there is no default.
 *
 * The Functions build excludes src/testing/, and no production module imports
 * this file (`slotBoundary.test.ts`), so a fixture candidate can never reach a
 * deployed function or the browser.
 */

export const FIXTURE_REPLACEMENT_VALIDATION = {
  policy: { id: "test-fixture-replacement-accept", version: 1 },
  outcome: "accepted",
} as const;

export interface FixtureSuggestionSetOptions {
  uid: string;
  suggestionSetId?: string;
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
  /** How many fixture candidates, `cand-1` … `cand-n`. */
  count?: number;
  createdAt: Date;
  /** Required: a fixture never picks a lifetime either. */
  expiresAt: Date;
}

/** `cand-{n}` with the meal `fixture-meal-{setId}-{n}`. */
export const fixtureCandidate = (suggestionSetId: string, slotId: NutritionSlotId, n: number) => ({
  candidateId: `cand-${n}`,
  meal: {
    mealId: `fixture-meal-${suggestionSetId}-${n}`,
    slotId,
    name: `Fixture suggestion ${n}`,
    values: { kcal: 311.5 + n, proteinG: 12.25, carbsG: 30, fatG: 9.5 },
  },
});

/** Stores a fixture set through the production storage helper. */
export const seedFixtureSuggestionSet = (
  firestore: Firestore,
  options: FixtureSuggestionSetOptions
): Promise<ReplacementSuggestionSet> => {
  const suggestionSetId = options.suggestionSetId ?? "set-1";
  return storeReplacementSuggestionSet(firestore, {
    uid: options.uid,
    suggestionSetId,
    planId: options.planId,
    date: options.date,
    slotId: options.slotId,
    candidates: Array.from({ length: options.count ?? 2 }, (_, index) =>
      fixtureCandidate(suggestionSetId, options.slotId, index + 1)
    ),
    validation: { policy: { ...FIXTURE_REPLACEMENT_VALIDATION.policy }, outcome: FIXTURE_REPLACEMENT_VALIDATION.outcome },
    createdAt: options.createdAt,
    expiresAt: options.expiresAt,
  });
};
