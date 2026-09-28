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

/** What `quotaPeriod` produces; an explicit period must look the same. */
const QUOTA_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The slice of a Firestore transaction the quota helpers need.
 *
 * Structural rather than the Admin SDK's `Transaction`, so a caller can hand
 * over a transaction it already owns without this module knowing whose it is.
 * That is what lets a quota reservation commit together with the operation
 * record that owns it, instead of in a second write that can fail on its own.
 */
export interface QuotaTransactionLike {
  get(ref: unknown): Promise<{ data(): FirebaseFirestore.DocumentData | undefined }>;
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
}

/**
 * A unit of the allowance held by a request that has not finished yet.
 *
 * `count` on its own cannot keep the promise the product makes. It is
 * incremented when a request is claimed, because a limit that is only applied
 * after the model answers is not a limit; but a process killed between those
 * two moments leaves that increment behind with no plan to show for it, and
 * the user has silently lost one of three *successful* generations.
 *
 * So the document also records which units are merely held and until when.
 * Anything past its expiry is no longer anyone's business — the claim that
 * took it cannot still be running — and is reclaimed by the next transaction
 * that reads the document. The allowance therefore converges on what it is
 * supposed to mean: generations that produced a plan, plus the ones still
 * genuinely in flight.
 *
 * An array rather than a map, because `set(…, { merge: true })` replaces an
 * array wholesale and merges a map key by key: a map could never have an entry
 * removed without a delete sentinel this transaction interface does not carry.
 */
export interface QuotaReservation {
  /** The logical request holding the unit. One request, at most one hold. */
  requestId: string;
  /** ISO-8601. Matches the claim lease of the operation that took it. */
  expiresAt: string;
}

/** What a request needs to identify its own hold. */
export interface QuotaHoldRef {
  uid: string;
  action: QuotaAction;
  requestId: string;
  /**
   * The period the hold is counted against. Omitted, it is the period of the
   * store's clock now — what every caller before NUT-12C.2 gets. A request
   * that can outlive a month boundary names the period of its first claim, so
   * finishing it after midnight on the 1st settles the hold it actually took
   * instead of looking for it in next month's document.
   */
  period?: string;
}

/**
 * One quota document, read inside a caller's transaction, whose holds can then
 * be changed without reading it again.
 *
 * A Firestore transaction must do all of its reads before its first write. A
 * caller that settles a hold together with other documents — a plan, a
 * request, an account state — therefore reads the ledger early, with its other
 * reads, and applies the change after them. Each change is written at once
 * and is cumulative, so several changes to one document in one transaction
 * (one request's hold released, another's reserved) leave it exactly as the
 * last one describes.
 */
export interface QuotaLedger {
  /** The period this document counts. */
  readonly period: string;
  /**
   * Take or renew `requestId`'s hold, as `reserveInTransaction` does. With
   * `renew`, the request's own hold is never reclaimed first, even past its
   * expiry: the request is being continued, and continuing it is not a second
   * unit. Returns the usage after the call, or null when the allowance is gone.
   */
  reserve(hold: { requestId: string; limit: number; expiresAt: Date; renew?: boolean }): number | null;
  /** Turn `requestId`'s hold into a permanent charge, as `consumeInTransaction` does. */
  consume(requestId: string): void;
  /** Give `requestId`'s hold back, as `releaseInTransaction` does. */
  release(requestId: string): void;
}

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
  /**
   * Take or renew one hold on the allowance, inside a caller's transaction.
   *
   * Keyed by request id, and therefore idempotent per logical request: a
   * retry that continues a claim after a crash finds the hold it inherited and
   * extends it rather than taking a second one. That is what lets the claim
   * decide ownership and this store decide cost, without either having to
   * trust a flag the other wrote.
   *
   * Returns the usage after the call, or null when the allowance is gone.
   */
  reserveInTransaction(
    tx: QuotaTransactionLike,
    hold: QuotaHoldRef & { limit: number; expiresAt: Date }
  ): Promise<number | null>;
  /**
   * Turn this request's hold into a permanent charge.
   *
   * The count does not move: the unit was already counted when it was
   * reserved, and what changes is only that nothing may reclaim it any more.
   * Runs in the transaction that writes the plan, so a generation is charged
   * exactly when — and only when — it is persisted.
   */
  consumeInTransaction(tx: QuotaTransactionLike, hold: QuotaHoldRef): Promise<void>;
  /**
   * Give this request's hold back inside a caller's transaction.
   *
   * Only a hold the request still owns is refunded, so a second release finds
   * nothing and changes nothing rather than handing out a free generation.
   */
  releaseInTransaction(tx: QuotaTransactionLike, hold: QuotaHoldRef): Promise<void>;
  /**
   * Read one document of the allowance inside a caller's transaction, for
   * changes the caller applies after the rest of its reads. The three
   * `…InTransaction` methods above are exactly this read followed by one
   * change.
   */
  readLedgerInTransaction(
    tx: QuotaTransactionLike,
    ref: { uid: string; action: QuotaAction; period?: string }
  ): Promise<QuotaLedger>;
}

export const createFirestoreQuotaStore = (
  options: FirestoreQuotaStoreOptions
): ReservingQuotaStore => {
  const { firestore } = options;
  const now = options.now ?? (() => new Date());

  const refAt = (uid: string, action: QuotaAction, period: string) =>
    firestore.collection(QUOTA_COLLECTION).doc(quotaDocId(uid, action, period));

  const ref = (uid: string, action: QuotaAction) => refAt(uid, action, quotaPeriod(now()));

  const readCount = (data: FirebaseFirestore.DocumentData | undefined): number => {
    const value = data?.count;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };

  const readReservations = (
    data: FirebaseFirestore.DocumentData | undefined
  ): QuotaReservation[] => {
    const value = data?.reservations;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is QuotaReservation =>
        typeof (entry as QuotaReservation | null)?.requestId === "string" &&
        typeof (entry as QuotaReservation | null)?.expiresAt === "string"
    );
  };

  /** What one quota document says, before reclamation. */
  interface Book {
    count: number;
    reservations: QuotaReservation[];
  }

  const bookOf = (data: FirebaseFirestore.DocumentData | undefined): Book => ({
    count: readCount(data),
    reservations: readReservations(data),
  });

  /**
   * The document as it should be read, with expired holds already reclaimed.
   *
   * A hold whose expiry cannot be parsed counts as expired. The store writes
   * that field itself, so an unreadable one means a corrupted document — and a
   * unit nobody can date is not evidence of a generation anybody received.
   * Reclaiming it is the direction that keeps the product's promise; the floor
   * at zero is what keeps that from ever becoming free generations.
   */
  const ledger = (
    book: Book,
    at: Date,
    /**
     * A request whose own hold is never treated as stale.
     *
     * Reclamation asks "is anyone still working on this?", and for the request
     * running the transaction the answer is yes by construction. Without the
     * exemption a hold that looked expired would be reclaimed and then dropped
     * in the same breath, and a generation that produced a plan would end up
     * costing nothing.
     */
    keep?: string
  ) => {
    const held = book.reservations;
    const live = held.filter((entry) => {
      if (entry.requestId === keep) return true;
      const expiry = Date.parse(entry.expiresAt);
      return Number.isFinite(expiry) && expiry > at.getTime();
    });
    return {
      /** Successful generations, plus the ones still genuinely in flight. */
      count: Math.max(0, book.count - (held.length - live.length)),
      reservations: live,
      reclaimed: held.length - live.length,
    };
  };

  const writeLedger = (
    tx: QuotaTransactionLike,
    docRef: unknown,
    at: Date,
    period: string,
    uid: string,
    action: QuotaAction,
    count: number,
    reservations: QuotaReservation[]
  ): void => {
    tx.set(
      docRef,
      {
        uid,
        action,
        period,
        count,
        reservations,
        updatedAt: at.toISOString(),
      },
      { merge: true }
    );
  };

  /*
    The read is here and nowhere else in the transactional path; every change
    below is a write against what it read, so a caller can put the read among
    its own reads and the change after them.
  */
  const readLedgerInTransaction = async (
    tx: QuotaTransactionLike,
    { uid, action, period }: { uid: string; action: QuotaAction; period?: string }
  ): Promise<QuotaLedger> => {
    const at = now();
    const bucket = period ?? quotaPeriod(at);
    if (!QUOTA_PERIOD_PATTERN.test(bucket)) throw new Error("A quota period is a UTC calendar month, YYYY-MM.");
    const docRef = refAt(uid, action, bucket);
    let book = bookOf((await tx.get(docRef)).data());

    const write = (count: number, reservations: QuotaReservation[]): void => {
      book = { count, reservations };
      writeLedger(tx, docRef, at, bucket, uid, action, count, reservations);
    };

    return {
      period: bucket,

      reserve: ({ requestId, limit, expiresAt, renew = false }) => {
        const current = ledger(book, at, renew ? requestId : undefined);
        const mine = { requestId, expiresAt: expiresAt.toISOString() };

        /*
          This request already holds a unit — it is being continued after its
          first invocation stopped, not started again. Extend the hold to the
          new claim's lease so nothing reclaims it while the retry is working,
          and charge nothing: one press, one unit, however many invocations it
          takes.
        */
        if (current.reservations.some((entry) => entry.requestId === requestId)) {
          write(
            current.count,
            current.reservations.map((entry) => (entry.requestId === requestId ? mine : entry))
          );
          return current.count;
        }

        if (current.count >= limit) {
          // Nothing to give. Units reclaimed by the read above are still worth
          // committing, so the next request does not have to find them again.
          if (current.reclaimed > 0) write(current.count, current.reservations);
          return null;
        }

        write(current.count + 1, [...current.reservations, mine]);
        return current.count + 1;
      },

      consume: (requestId) => {
        /*
          The count stays where it is: this unit was counted when it was
          reserved, and it has now bought a plan. Dropping the hold is the
          whole transition — it is what stops the unit from ever being
          reclaimed.

          A request finalising without a live hold is not treated as a new
          charge either. Its own hold is exempt from reclamation, and a
          document written before holds were recorded already carries the
          claim's increment in the count — so the unit is counted exactly once
          however the record looks, and finalising is only ever the act of
          making it permanent.
        */
        const current = ledger(book, at, requestId);
        write(
          current.count,
          current.reservations.filter((entry) => entry.requestId !== requestId)
        );
      },

      release: (requestId) => {
        const current = ledger(book, at);
        const remaining = current.reservations.filter((entry) => entry.requestId !== requestId);

        // Only a unit this request still owns is given back. A repeated
        // release, or one from an attempt whose hold was already reclaimed,
        // finds nothing and changes nothing — a refund it never paid for would
        // be a free plan.
        const refund = remaining.length < current.reservations.length ? 1 : 0;
        write(Math.max(0, current.count - refund), remaining);
      },
    };
  };

  return {
    currentPeriod: () => quotaPeriod(now()),

    /*
      Reported usage excludes expired holds for the same reason enforcement
      does: a number the UI shows as "2 of 3 left" has to mean the same thing
      as the number that refuses the next request.
    */
    getUsage: async (uid, action) => {
      const snap = await ref(uid, action).get();
      return ledger(bookOf(snap.data()), now()).count;
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

    reserveInTransaction: async (tx, { uid, action, requestId, limit, expiresAt, period }) =>
      (await readLedgerInTransaction(tx, { uid, action, period })).reserve({ requestId, limit, expiresAt }),

    consumeInTransaction: async (tx, { uid, action, requestId, period }) => {
      (await readLedgerInTransaction(tx, { uid, action, period })).consume(requestId);
    },

    releaseInTransaction: async (tx, { uid, action, requestId, period }) => {
      (await readLedgerInTransaction(tx, { uid, action, period })).release(requestId);
    },

    readLedgerInTransaction,

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
