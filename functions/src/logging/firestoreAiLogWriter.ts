import type { Firestore } from "firebase-admin/firestore";
import type {
  RecommendationCategory,
  RecommendationRejection,
} from "../../../shared/weeklyRecommendation";
import { findForbiddenLogFields, type AiLogEntry, type AiLogWriter } from "./aiLog";

/**
 * The real log writer.
 *
 * Writes to a top-level `_ai_logs`, denied to every client by
 * firestore.rules. It deliberately does *not* write to
 * `users/{uid}/ai_logs`, which the owner can edit: an operational record of
 * what was spent is worthless if the person it bills can rewrite it.
 *
 * A log says what happened, never what was said. Prompts and model responses
 * are not stored, and the forbidden-field check runs on the way out rather
 * than being left to reviewers to notice.
 */

export const AI_LOG_COLLECTION = "_ai_logs";

/** What every server-written log entry carries, whatever the action was. */
export interface ServerAiLogEntry extends AiLogEntry {
  uid: string;
  /** False when the failure happened before any provider call — no cost. */
  providerCalled: boolean;
}

export interface PlanGenerationLogEntry extends ServerAiLogEntry {
  /** True when the first attempt failed validation and a repair was tried. */
  schemaRepairUsed?: boolean;
  /** Only on success. */
  planId?: string;
}

/**
 * A weekly-review call.
 *
 * `category` is the conclusion the deterministic rules reached — a five-value
 * enum, not a statement about the person — and `rejection` says which gate
 * refused a model's wording. Neither carries the wording itself: the rule
 * that a log says what happened and never what was said holds here too.
 */
export interface WeeklyReviewLogEntry extends ServerAiLogEntry {
  category?: RecommendationCategory;
  rejection?: RecommendationRejection;
}

export interface FirestoreAiLogWriterOptions {
  firestore: Firestore;
}

export const createFirestoreAiLogWriter = (
  options: FirestoreAiLogWriterOptions
): AiLogWriter & {
  writeEntry(entry: PlanGenerationLogEntry | WeeklyReviewLogEntry): Promise<void>;
} => {
  const write = async (entry: Record<string, unknown>): Promise<void> => {
    const forbidden = findForbiddenLogFields(entry);
    if (forbidden.length > 0) {
      // Refuse the document rather than the request: a log is operational, and
      // losing one is better than storing a prompt.
      throw new Error(`Refusing to log forbidden fields: ${forbidden.join(", ")}`);
    }

    // undefined is not a Firestore value; absent stays absent rather than null,
    // so "no token usage reported" and "zero tokens" stay distinguishable.
    const document = Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined)
    );

    await options.firestore.collection(AI_LOG_COLLECTION).add(document);
  };

  return {
    write: (uid, entry) => write({ ...entry, uid }),
    writeEntry: (entry) => write({ ...entry }),
  };
};
