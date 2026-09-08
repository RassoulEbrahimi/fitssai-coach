import type { Firestore } from "firebase-admin/firestore";
import { AiError } from "./errors";

/**
 * Duplicate-request protection.
 *
 * A double-click, a lost response or a network retry must not produce two
 * plans and two charges against a three-per-month quota. The client sends an
 * opaque request id; the server claims it once, and a replay of the same id by
 * the same user returns the plan the first call produced instead of generating
 * another.
 *
 * The id is namespaced by uid, so one user replaying another's request id
 * reaches a different document and gets nothing. It never becomes the plan id
 * — a client-chosen document id is a client-chosen write target, and a plan id
 * a caller can predict is one a caller can pre-create to make the server's own
 * write fail.
 *
 * The record owns three things that have to agree: the claim, the quota
 * reservation the claim took, and the plan the claim eventually produced. Each
 * transition below writes all of them at once, because the failure this module
 * exists to prevent is exactly the state where they disagree — a plan on disk
 * that the bookkeeping calls a failure.
 */

export const OPERATION_COLLECTION = "_ai_operations";

/**
 * How long a claim stays another invocation's business.
 *
 * `generateWorkoutPlan` is configured with a 180s execution budget, so an
 * invocation cannot still be alive after it: the lease is that budget plus a
 * margin for a claim written just before the clock started. Shorter would let
 * a live invocation be taken over and its provider call paid for twice; much
 * longer would leave a crashed one unrecoverable for no reason.
 */
export const CLAIM_LEASE_MS = 240_000;

/** A v4-shaped UUID. Narrow on purpose: the id is a key, not a free-text field. */
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

export const operationDocId = (uid: string, requestId: string): string =>
  `${uid}__${requestId.toLowerCase()}`;

export type OperationStatus = "in_progress" | "completed" | "failed";

/**
 * The slice of a Firestore transaction handed to the caller's callbacks.
 *
 * Structural, so the callbacks can be written against it without importing the
 * Admin SDK's `Transaction`, and so this module never decides what they write.
 */
export interface OperationTransaction {
  get(ref: unknown): Promise<{ data(): Record<string, unknown> | undefined }>;
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  create(ref: unknown, data: Record<string, unknown>): void;
}

export type ClaimResult =
  /** This invocation owns the request, and may spend money on it. */
  | { kind: "claimed"; claimToken: string; planId: string }
  /** The request already finished. Its plan is the answer. */
  | { kind: "replay"; planId: string }
  /** Another invocation holds a live claim on it. */
  | { kind: "in_progress" }
  /** The request is new, but the period's allowance is gone. */
  | { kind: "quota_exceeded" };

export type FinalizeResult =
  /** The plan and the completed record committed together. */
  | { kind: "committed"; planId: string }
  /** Another invocation finished first; this one's work is discarded. */
  | { kind: "superseded"; planId: string }
  /** This claim expired and another invocation owns the request now. */
  | { kind: "lost" };

export interface ClaimInput {
  uid: string;
  requestId: string;
  /**
   * Mints the plan id the request will use, once, on the first claim.
   *
   * Reserved at claim time rather than chosen at write time so a retry after a
   * crash writes to the same document as the attempt it continues, and so the
   * id is the server's rather than derivable from what the client sent.
   */
  mintPlanId: () => string;
  /**
   * Takes the request's one quota reservation, inside the claim's transaction.
   *
   * Called on every claim, including a takeover, and given the lease the claim
   * is about to write so the hold and the claim stop being live at the same
   * moment. Charging once per logical request is the store's job rather than
   * this record's: keyed by request id, it recognises a continuation and
   * renews the hold instead of taking a second one. A flag here could only say
   * that *something* was once charged, which is not the same question — a unit
   * reclaimed after this claim was abandoned has to be taken again.
   *
   * Returning false means the period's allowance is gone and nothing is
   * claimed.
   */
  reserveQuota: (tx: OperationTransaction, leaseExpiresAt: Date) => Promise<boolean>;
}

export interface FinalizeInput {
  uid: string;
  requestId: string;
  /** Proves this invocation still owns the claim it is finalising. */
  claimToken: string;
  /**
   * Turns the request's reservation into a charge, in the same transaction.
   *
   * The plan, the completed record and the charge for it therefore commit as
   * one write or not at all — there is no ordering of failures that leaves a
   * plan somebody was not charged for, or a charge with no plan behind it.
   */
  consumeQuota: (tx: OperationTransaction) => Promise<void>;
  /** Writes the result document, in the same transaction as the completion. */
  writeResult: (tx: OperationTransaction, planId: string) => void;
}

export interface FailInput {
  uid: string;
  requestId: string;
  /** Absent when the request was never claimed; then nothing is written. */
  claimToken?: string;
  /** Gives the request's reservation back, inside the failure's transaction. */
  releaseQuota: (tx: OperationTransaction) => Promise<void>;
}

export interface OperationStore {
  /**
   * Take ownership of a request id, or report what already happened to it.
   *
   * The read, the quota reservation and the write are one transaction, so two
   * simultaneous calls with the same id cannot both be told they own it, and a
   * claim can never exist without the reservation that paid for it.
   */
  claim(input: ClaimInput): Promise<ClaimResult>;
  /**
   * Commit the plan and the completed record together.
   *
   * Nothing after this may undo either. The state this module exists to
   * prevent — a persisted plan the bookkeeping calls a failure — is only
   * unreachable if these two writes cannot be separated.
   */
  finalize(input: FinalizeInput): Promise<FinalizeResult>;
  /**
   * Record that the attempt produced nothing, and give its reservation back.
   *
   * Refuses to touch a completed record or one owned by a newer claim: a slow
   * invocation waking up after it lost the request must not be able to mark
   * somebody else's success a failure.
   */
  fail(input: FailInput): Promise<void>;
}

/** Distinct per claim, so ownership is provable rather than assumed. */
const newClaimToken = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const readString = (data: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = data?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** An unreadable or absent expiry counts as expired: a stuck record is worse. */
const leaseIsLive = (data: Record<string, unknown> | undefined, at: Date): boolean => {
  const expiry = Date.parse(String(data?.leaseExpiresAt ?? ""));
  return Number.isFinite(expiry) && expiry > at.getTime();
};

export const createFirestoreOperationStore = (
  firestore: Firestore,
  now: () => Date = () => new Date()
): OperationStore => {
  const ref = (uid: string, requestId: string) =>
    firestore.collection(OPERATION_COLLECTION).doc(operationDocId(uid, requestId));

  const inTransaction = <T>(body: (transaction: OperationTransaction) => Promise<T>): Promise<T> =>
    (
      firestore as unknown as {
        runTransaction: (fn: (t: OperationTransaction) => Promise<T>) => Promise<T>;
      }
    ).runTransaction(body);

  return {
    claim: async ({ uid, requestId, mintPlanId, reserveQuota }) =>
      inTransaction<ClaimResult>(async (transaction) => {
        const at = now();
        const docRef = ref(uid, requestId);
        const data = (await transaction.get(docRef)).data();
        const status = data?.status as OperationStatus | undefined;
        const knownPlanId = readString(data, "planId");

        if (status === "completed" && knownPlanId) {
          return { kind: "replay", planId: knownPlanId };
        }
        if (status === "in_progress" && leaseIsLive(data, at)) return { kind: "in_progress" };

        /*
          Either new, or a failed attempt being retried, or a claim whose
          invocation is past the point where it could still be running.
          Whichever it is, this invocation continues the same logical request:
          the reservation and the reserved plan id carry over rather than being
          taken again, so a crash cannot cost a user two of their three plans.
        */
        const leaseExpiresAt = new Date(at.getTime() + CLAIM_LEASE_MS);
        if (!(await reserveQuota(transaction, leaseExpiresAt))) {
          return { kind: "quota_exceeded" };
        }

        const claimToken = newClaimToken();
        const planId = knownPlanId ?? mintPlanId();
        const attempts = typeof data?.attempts === "number" ? data.attempts : 0;

        transaction.set(
          docRef,
          {
            uid,
            status: "in_progress",
            claimToken,
            planId,
            // Descriptive, for anyone reading a record in the console. The
            // allowance itself is the quota document's business, not this
            // one's: two documents that both decide cost would eventually
            // disagree about it.
            quotaCharged: true,
            attempts: attempts + 1,
            startedAt: readString(data, "startedAt") ?? at.toISOString(),
            claimedAt: at.toISOString(),
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
          { merge: true }
        );

        return { kind: "claimed", claimToken, planId };
      }),

    finalize: async ({ uid, requestId, claimToken, consumeQuota, writeResult }) =>
      inTransaction<FinalizeResult>(async (transaction) => {
        const at = now();
        const docRef = ref(uid, requestId);
        const data = (await transaction.get(docRef)).data();
        const planId = readString(data, "planId");

        /*
          A finished request first, and unconditionally. Completion clears the
          lease, so asking about the lease before this would turn every replay
          into a refusal.
        */
        if (data?.status === "completed" && planId) {
          return { kind: "superseded", planId };
        }
        // Not ours any more: another invocation took the request over while
        // this one was with the provider. Its plan is the one that counts.
        if (readString(data, "claimToken") !== claimToken || !planId) return { kind: "lost" };
        /*
          Ours by name, but not any more in fact. Past the lease this claim is
          not evidence that anybody is still working on the request: the
          reservation that paid for it may already have been reclaimed by
          somebody else's transaction, and committing here would write a plan
          nothing is charged for. The token alone cannot see that, because the
          reservation lives on a document other requests are entitled to
          change — so the lease is what has to be checked, and it is checked
          here rather than left to the execution budget to make unreachable.
        */
        if (!leaseIsLive(data, at)) return { kind: "lost" };

        // Before any write in this transaction: the quota read has to happen
        // while reads are still allowed.
        await consumeQuota(transaction);
        writeResult(transaction, planId);
        transaction.set(
          docRef,
          {
            uid,
            status: "completed",
            planId,
            quotaCharged: true,
            completedAt: at.toISOString(),
            leaseExpiresAt: null,
          },
          { merge: true }
        );

        return { kind: "committed", planId };
      }),

    fail: async ({ uid, requestId, claimToken, releaseQuota }) => {
      if (claimToken === undefined) return;
      await inTransaction<void>(async (transaction) => {
        const at = now();
        const docRef = ref(uid, requestId);
        const data = (await transaction.get(docRef)).data();

        // A completed request is finished for good, and a claim we no longer
        // hold is not ours to fail.
        if (data?.status === "completed") return;
        if (readString(data, "claimToken") !== claimToken) return;

        await releaseQuota(transaction);
        transaction.set(
          docRef,
          {
            uid,
            status: "failed",
            quotaCharged: false,
            claimToken: null,
            leaseExpiresAt: null,
            failedAt: at.toISOString(),
          },
          { merge: true }
        );
      });
    },
  };
};

export const requireValidRequestId = (value: unknown): string => {
  if (!isValidRequestId(value)) {
    throw new AiError("INVALID_REQUEST", "requestId must be a v4 UUID.");
  }
  return value;
};
