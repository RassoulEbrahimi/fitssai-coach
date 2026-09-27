import type { Firestore } from "firebase-admin/firestore";

/**
 * The generic core of `_ai_operations`: one server-only record per logical
 * request of one operation family, which proves who owns the request right now
 * and what became of it.
 *
 * Only the record's own bookkeeping lives here — reading it, claiming it with a
 * lease, and ending it. Every write happens inside a transaction the caller
 * owns, so the caller commits the record together with whatever else has to
 * agree with it (a Workout plan and its quota charge; a Nutrition plan, its
 * generation request and the account state). What an operation costs, what it
 * produces and whether a failed attempt may be retried are the family's rules,
 * not this module's:
 *
 *   Workout plan generation   `./idempotency` — a failed attempt is retried
 *                             under the same id, and quota is reserved and
 *                             charged with the record
 *   Nutrition plan generation `./nutrition/generationLifecycle` — every
 *                             outcome is final, and nothing is charged
 *
 * The lease duration is the family's operational setting, passed in; nothing
 * here chooses one.
 */

export const OPERATION_COLLECTION = "_ai_operations";

/**
 * `in_progress`: claimed and possibly still running. `completed`: finished
 * with its result. `failed`: finished without one. `discarded`: finished,
 * but its result no longer applied and was not used.
 */
export type OperationRecordStatus = "in_progress" | "completed" | "failed" | "discarded";

/** An operation family: where its records live, and how they are tagged. */
export interface OperationNamespace {
  /** The family's name; stored on the record unless the family predates namespaces. */
  readonly name: string;
  /** The record's document id for one account's request. */
  docId(uid: string, requestId: string): string;
  /**
   * The `namespace` field the family's records carry, or undefined for the
   * family whose records were written before namespaces existed.
   */
  readonly recordTag: string | undefined;
}

/**
 * Workout plan generation: the family `_ai_operations` was built for. Its
 * records keep exactly the id and fields they have always had —
 * `{uid}__{requestId}`, no namespace field — so every existing record, and
 * every replay of one, stays where it is.
 */
export const WORKOUT_PLAN_OPERATIONS: OperationNamespace = Object.freeze({
  name: "workoutPlan",
  docId: (uid: string, requestId: string) => `${uid}__${requestId.toLowerCase()}`,
  recordTag: undefined,
});

/**
 * Nutrition plan generation: `nutritionPlan__{uid}__{requestId}`, tagged
 * `namespace: "nutritionPlan"`. The same account reusing one UUID for a
 * Workout and a Nutrition request therefore reaches two records.
 */
export const NUTRITION_PLAN_OPERATIONS: OperationNamespace = Object.freeze({
  name: "nutritionPlan",
  docId: (uid: string, requestId: string) => `nutritionPlan__${uid}__${requestId.toLowerCase()}`,
  recordTag: "nutritionPlan",
});

/** A record another family wrote was read under this family's id. Never treated as this family's. */
export class OperationNamespaceConflictError extends Error {
  constructor(expected: string) {
    super(`An operation record under a ${expected} id belongs to another operation family.`);
    this.name = "OperationNamespaceConflictError";
  }
}

/** The slice of a Firestore transaction the record needs. Structural, so any caller's transaction fits. */
export interface OperationRecordTransaction {
  get(ref: unknown): Promise<{ data(): Record<string, unknown> | undefined }>;
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
}

/** What a record says, read at one instant. */
export interface OperationRecord {
  exists: boolean;
  status: OperationRecordStatus | undefined;
  claimToken: string | undefined;
  /** The result id reserved at the first claim, kept by every later one. */
  planId: string | undefined;
  attempts: number;
  startedAt: string | undefined;
  /** The claim's lease had not run out at the instant it was read. */
  leaseLive: boolean;
}

/** Distinct per claim, so ownership is provable rather than assumed. */
export const newClaimToken = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const readString = (data: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = data?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** An unreadable or absent expiry counts as expired: a stuck record is worse. */
const leaseIsLive = (data: Record<string, unknown> | undefined, at: Date): boolean => {
  const expiry = Date.parse(String(data?.leaseExpiresAt ?? ""));
  return Number.isFinite(expiry) && expiry > at.getTime();
};

const STATUSES: readonly OperationRecordStatus[] = ["in_progress", "completed", "failed", "discarded"];

export interface OperationRecordStoreOptions {
  firestore: Firestore;
  namespace: OperationNamespace;
  /** How long a claim stays its invocation's business. The family's operational setting. */
  leaseMs: number;
}

export interface OperationRecordStore {
  readonly namespace: OperationNamespace;
  /** The record's document reference. */
  ref(uid: string, requestId: string): unknown;
  /** The record as it is inside `tx`, judged at `at`. A record of another family throws. */
  read(tx: OperationRecordTransaction, uid: string, requestId: string, at: Date): Promise<OperationRecord>;
  /** The lease a claim written at `at` holds. */
  leaseExpiry(at: Date): Date;
  /**
   * Claim the request: a new token, one more attempt, the reserved result id
   * kept (or the one given), the original start kept. `fields` are the
   * family's own additions.
   */
  writeClaim(
    tx: OperationRecordTransaction,
    claim: {
      uid: string;
      requestId: string;
      previous: OperationRecord;
      at: Date;
      claimToken: string;
      planId: string;
      fields?: Record<string, unknown>;
    }
  ): void;
  /** Finished with its result. The lease is cleared: a completed record is never live again. */
  writeCompleted(
    tx: OperationRecordTransaction,
    end: { uid: string; requestId: string; at: Date; planId: string; fields?: Record<string, unknown> }
  ): void;
  /** Finished without a result, as failed or as discarded. Ownership and lease are cleared. */
  writeEnded(
    tx: OperationRecordTransaction,
    end: { uid: string; requestId: string; at: Date; status: "failed" | "discarded"; fields?: Record<string, unknown> }
  ): void;
}

export const createOperationRecordStore = ({
  firestore,
  namespace,
  leaseMs,
}: OperationRecordStoreOptions): OperationRecordStore => {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("An operation lease must be a positive duration.");

  const ref = (uid: string, requestId: string) =>
    firestore.collection(OPERATION_COLLECTION).doc(namespace.docId(uid, requestId));
  const tag = namespace.recordTag === undefined ? {} : { namespace: namespace.recordTag };

  return {
    namespace,
    ref,

    read: async (tx, uid, requestId, at) => {
      const data = (await tx.get(ref(uid, requestId))).data();
      if (data !== undefined && data.namespace !== namespace.recordTag) {
        throw new OperationNamespaceConflictError(namespace.name);
      }
      const status = data?.status;
      return {
        exists: data !== undefined,
        status: STATUSES.includes(status as OperationRecordStatus) ? (status as OperationRecordStatus) : undefined,
        claimToken: readString(data, "claimToken"),
        planId: readString(data, "planId"),
        attempts: typeof data?.attempts === "number" ? data.attempts : 0,
        startedAt: readString(data, "startedAt"),
        leaseLive: leaseIsLive(data, at),
      };
    },

    leaseExpiry: (at) => new Date(at.getTime() + leaseMs),

    writeClaim: (tx, { uid, requestId, previous, at, claimToken, planId, fields }) => {
      tx.set(
        ref(uid, requestId),
        {
          uid,
          ...tag,
          status: "in_progress",
          claimToken,
          planId,
          ...fields,
          attempts: previous.attempts + 1,
          startedAt: previous.startedAt ?? at.toISOString(),
          claimedAt: at.toISOString(),
          leaseExpiresAt: new Date(at.getTime() + leaseMs).toISOString(),
        },
        { merge: true }
      );
    },

    writeCompleted: (tx, { uid, requestId, at, planId, fields }) => {
      tx.set(
        ref(uid, requestId),
        { uid, ...tag, status: "completed", planId, ...fields, completedAt: at.toISOString(), leaseExpiresAt: null },
        { merge: true }
      );
    },

    writeEnded: (tx, { uid, requestId, at, status, fields }) => {
      tx.set(
        ref(uid, requestId),
        {
          uid,
          ...tag,
          status,
          ...fields,
          claimToken: null,
          leaseExpiresAt: null,
          [status === "failed" ? "failedAt" : "discardedAt"]: at.toISOString(),
        },
        { merge: true }
      );
    },
  };
};
