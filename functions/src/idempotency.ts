import type { Firestore } from "firebase-admin/firestore";
import { AiError } from "./errors";

/**
 * Duplicate-request protection.
 *
 * A double-click or a network retry must not produce two plans and two charges
 * against a three-per-month quota. The client sends an opaque request id; the
 * server claims it once, and a replay of the same id by the same user returns
 * the plan the first call produced instead of generating another.
 *
 * The id is namespaced by uid, so one user replaying another's request id
 * reaches a different document and gets nothing. It never becomes the plan id
 * — a client-chosen document id is a client-chosen write target.
 */

export const OPERATION_COLLECTION = "_ai_operations";

/** A v4-shaped UUID. Narrow on purpose: the id is a key, not a free-text field. */
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

export const operationDocId = (uid: string, requestId: string): string =>
  `${uid}__${requestId.toLowerCase()}`;

export type OperationStatus = "in_progress" | "completed" | "failed";

export interface CompletedOperation {
  status: "completed";
  planId: string;
}

export type ClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; planId: string }
  | { kind: "in_progress" };

export interface OperationStore {
  /**
   * Take ownership of a request id, or report what already happened to it.
   *
   * The read and the write are one transaction, so two simultaneous calls with
   * the same id cannot both be told they own it.
   */
  claim(uid: string, requestId: string): Promise<ClaimResult>;
  complete(uid: string, requestId: string, planId: string): Promise<void>;
  fail(uid: string, requestId: string): Promise<void>;
}

export const createFirestoreOperationStore = (
  firestore: Firestore,
  now: () => Date = () => new Date()
): OperationStore => {
  const ref = (uid: string, requestId: string) =>
    firestore.collection(OPERATION_COLLECTION).doc(operationDocId(uid, requestId));

  return {
    claim: async (uid, requestId) =>
      firestore.runTransaction<ClaimResult>(async (tx) => {
        const docRef = ref(uid, requestId);
        const snap = await tx.get(docRef);
        const data = snap.data();
        const status = data?.status as OperationStatus | undefined;

        if (status === "completed" && typeof data?.planId === "string") {
          return { kind: "replay", planId: data.planId };
        }
        if (status === "in_progress") return { kind: "in_progress" };

        // A previously failed attempt may be retried with the same id: nothing
        // was persisted and nothing was charged, so there is nothing to reuse.
        tx.set(docRef, { uid, status: "in_progress", startedAt: now().toISOString() });
        return { kind: "claimed" };
      }),

    complete: async (uid, requestId, planId) => {
      await ref(uid, requestId).set(
        { uid, status: "completed", planId, completedAt: now().toISOString() },
        { merge: true }
      );
    },

    fail: async (uid, requestId) => {
      await ref(uid, requestId).set(
        { uid, status: "failed", failedAt: now().toISOString() },
        { merge: true }
      );
    },
  };
};

export const requireValidRequestId = (value: unknown): string => {
  if (!isValidRequestId(value)) {
    throw new AiError("INVALID_REQUEST", "requestId must be a v4 UUID.");
  }
  return value;
};
