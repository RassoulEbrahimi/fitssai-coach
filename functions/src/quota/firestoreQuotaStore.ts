import type { Firestore } from "firebase-admin/firestore";
import type { QuotaAction, QuotaStore } from "./index";

/**
 * The real quota store: a counter per user, action and calendar month.
 *
 * Server-only. `_ai_quota` is denied to every client by firestore.rules, so
 * the only way to change a counter is through the Admin SDK — which is the
 * whole point, because this counter is what stands between a user and an
 * unbounded provider bill.
 *
 * A calendar month was chosen over a rolling 30-day window deliberately. A
 * rolling window needs a list of timestamps per user, pruning, and a read that
 * grows with usage; a calendar bucket is a single document with a single
 * integer, and the period is derivable from a date with no state at all. The
 * cost is a boundary effect — someone can use three on the 31st and three on
 * the 1st — which is acceptable for a cost control at this size and would not
 * be for a security control.
 */

export const QUOTA_COLLECTION = "_ai_quota";

/** `2026-08`, in UTC. The period must not depend on where a caller sits. */
export const quotaPeriod = (now: Date): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * One document per user, action and period.
 *
 * The uid is embedded rather than used as the document id so a single
 * collection covers every action without a subcollection per user — and
 * because a uid alone would collide across actions.
 */
export const quotaDocId = (uid: string, action: QuotaAction, period: string): string =>
  `${uid}__${action}__${period}`;

export interface FirestoreQuotaStoreOptions {
  firestore: Firestore;
  /** Injected so tests are not at the mercy of the wall clock. */
  now?: () => Date;
}

/**
 * A store that can also reserve and release.
 *
 * Reserving before the provider call is what makes concurrency safe: two
 * requests arriving together both run the same transaction, so the second sees
 * the first's increment. Releasing on failure is what keeps the promise that
 * only a successful, persisted plan is charged.
 */
export interface ReservingQuotaStore extends QuotaStore {
  /**
   * Increment if the limit allows, atomically. Returns the usage after the
   * reservation, or null when the limit is already reached.
   */
  reserve(uid: string, action: QuotaAction, limit: number): Promise<number | null>;
  /** Give a reservation back. Never drops below zero. */
  release(uid: string, action: QuotaAction): Promise<void>;
  /** The period a call now would be counted against. */
  currentPeriod(): string;
}

export const createFirestoreQuotaStore = (
  options: FirestoreQuotaStoreOptions
): ReservingQuotaStore => {
  const { firestore } = options;
  const now = options.now ?? (() => new Date());

  const ref = (uid: string, action: QuotaAction) =>
    firestore.collection(QUOTA_COLLECTION).doc(quotaDocId(uid, action, quotaPeriod(now())));

  const readCount = (data: FirebaseFirestore.DocumentData | undefined): number => {
    const value = data?.count;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };

  return {
    currentPeriod: () => quotaPeriod(now()),

    getUsage: async (uid, action) => {
      const snap = await ref(uid, action).get();
      return readCount(snap.data());
    },

    increment: async (uid, action) => {
      const at = now();
      await firestore.runTransaction(async (tx) => {
        const docRef = ref(uid, action);
        const snap = await tx.get(docRef);
        tx.set(
          docRef,
          {
            uid,
            action,
            period: quotaPeriod(at),
            count: readCount(snap.data()) + 1,
            updatedAt: at.toISOString(),
          },
          { merge: true }
        );
      });
    },

    reserve: async (uid, action, limit) => {
      const at = now();
      return firestore.runTransaction(async (tx) => {
        const docRef = ref(uid, action);
        const snap = await tx.get(docRef);
        const used = readCount(snap.data());
        if (used >= limit) return null;

        const next = used + 1;
        tx.set(
          docRef,
          {
            uid,
            action,
            period: quotaPeriod(at),
            count: next,
            updatedAt: at.toISOString(),
          },
          { merge: true }
        );
        return next;
      });
    },

    release: async (uid, action) => {
      const at = now();
      await firestore.runTransaction(async (tx) => {
        const docRef = ref(uid, action);
        const snap = await tx.get(docRef);
        const used = readCount(snap.data());
        // Floored at zero: a double release must not hand out a free call.
        if (used === 0) return;
        tx.set(docRef, { count: used - 1, updatedAt: at.toISOString() }, { merge: true });
      });
    },
  };
};
