import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_V2_SUGGESTIONS_COLLECTION,
  replacementSuggestionSetSchema,
  type NutritionDate,
  type NutritionSlotId,
  type PlannedMeal,
  type ReplacementSuggestionSet,
  type ReplacementValidationProvenance,
} from "../../../shared/nutrition";
import { NutritionSlotError } from "./errors";

/**
 * Server-only storage of Nutrition V2 replacement suggestion sets (NUT-10).
 *
 * `_nutrition_v2_suggestions/{uid}__{suggestionSetId}` is read and written by
 * the Admin SDK only; the Firestore rules deny every client. This module
 * stores a set a server-side source has ALREADY produced and normalised. It
 * produces nothing itself: no provider, no prompt, no candidate, no meal
 * content from a browser — and it is not exported as a callable. The
 * production source of suggestions (NUT-12) does not exist yet, so in
 * production nothing calls it.
 *
 * There is no suggestion lifetime here. `expiresAt` is required from the
 * caller, and a commit refuses a set once it has passed; how long a set lives
 * is an operational decision that is not made in this repository. The field is
 * a Firestore timestamp, so a TTL policy can be enabled on it; none is
 * configured here.
 */

/** `{uid}__{suggestionSetId}`: a set is filed under the account it belongs to. */
export const suggestionSetDocId = (uid: string, suggestionSetId: string): string => `${uid}__${suggestionSetId}`;

export const suggestionSetRef = (firestore: Firestore, uid: string, suggestionSetId: string) =>
  firestore.collection(NUTRITION_V2_SUGGESTIONS_COLLECTION).doc(suggestionSetDocId(uid, suggestionSetId));

export interface StoreReplacementSuggestionSetInput {
  /** The verified account the set is for. Never a uid a browser sent. */
  uid: string;
  suggestionSetId: string;
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
  /** Server-normalised candidates, each a complete planned meal for the slot. */
  candidates: ReadonlyArray<{ candidateId: string; meal: PlannedMeal }>;
  validation: ReplacementValidationProvenance;
  createdAt: Date;
  /** Supplied by the caller. No lifetime is chosen here. */
  expiresAt: Date;
}

const toStructural = (instant: Date) => {
  const timestamp = Timestamp.fromDate(instant);
  return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
};

/**
 * Validates the complete set and creates it — never overwrites an existing
 * set. Every candidate starts unconsumed. Returns the set as stored
 * (structural timestamps).
 */
export const storeReplacementSuggestionSet = async (
  firestore: Firestore,
  input: StoreReplacementSuggestionSetInput
): Promise<ReplacementSuggestionSet> => {
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new NutritionSlotError("INTERNAL", "The suggestion set needs a creation instant.");
  }
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
    throw new NutritionSlotError("INTERNAL", "The suggestion set needs an explicit expiry instant.");
  }

  const parsed = replacementSuggestionSetSchema.safeParse({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    ownerUid: input.uid,
    suggestionSetId: input.suggestionSetId,
    planId: input.planId,
    date: input.date,
    slotId: input.slotId,
    candidates: input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      meal: candidate.meal,
      consumedByRequestId: null,
    })),
    validation: input.validation,
    createdAt: toStructural(input.createdAt),
    expiresAt: toStructural(input.expiresAt),
  });
  if (!parsed.success) throw new NutritionSlotError("INTERNAL", "The suggestion set is not valid.");
  const set = parsed.data;

  await suggestionSetRef(firestore, input.uid, input.suggestionSetId).create({
    ...set,
    createdAt: Timestamp.fromDate(input.createdAt),
    expiresAt: Timestamp.fromDate(input.expiresAt),
  });
  return set;
};
