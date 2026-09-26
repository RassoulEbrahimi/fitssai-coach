import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { NUTRITION_V2_COLLECTIONS, type NutritionEntryIntent } from "@shared/nutrition";
import { applyNutritionEntryIntent, type NutritionEntryWriteResult } from "./entryTransaction";

/**
 * The one online Nutrition V2 write: a recorded entry, through a Firestore
 * transaction (compare-and-set on its revision, see `./entryTransaction`).
 *
 * It writes `users/{uid}/nutrition_v2_entries/{entryId}` and nothing else — no
 * other Nutrition collection, never legacy Nutrition, never a delete. Slot
 * entries and extra entries alike are addressed by their id (an extra's UUID
 * is chosen before the write), so there is no `addDoc`.
 *
 * Online only. There is no queue, no optimistic result and no replay here:
 * the caller gets the committed result, a `NutritionEntryConflictError`, or the
 * Firestore error.
 */
export const writeNutritionV2Entry = (uid: string, intent: NutritionEntryIntent): Promise<NutritionEntryWriteResult> => {
  if (typeof uid !== "string" || uid.length === 0) {
    return Promise.reject(new Error("Nutrition V2 writes need an authenticated uid"));
  }
  const ref = doc(db, "users", uid, NUTRITION_V2_COLLECTIONS.entries, intent.entryId);
  // The intent — and its id — is fixed before the transaction starts, so every
  // retry Firestore makes of this callback applies the same intent.
  return runTransaction(db, (transaction) => applyNutritionEntryIntent(transaction, ref, intent));
};
