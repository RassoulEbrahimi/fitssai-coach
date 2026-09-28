import { describe, it, expect } from "vitest";
import { DEFAULT_QUOTA_LIMITS } from "./index";
import { QUOTA_COLLECTION, createFirestoreQuotaStore, quotaDocId, type QuotaTransactionLike } from "./firestoreQuotaStore";
import { fakeFirestore, type FakeFirestore } from "../testing/fakeFirestore";

/*
  NUT-12C.2: the quota store's transactional ledger.

  `readLedgerInTransaction` is the one read of a quota document; every change
  after it is a write, so a caller can put the read among its own reads and
  settle the hold after them. The three `…InTransaction` methods Training uses
  are that read plus one change, and — without a period — still count against
  the month of the store's clock, exactly as before. An explicit period is
  what lets a request that outlives a month boundary settle the hold of the
  month it was claimed in.
*/

const UID = "alice";
const SEPTEMBER_END = new Date("2026-09-30T23:59:30.000Z");
const OCTOBER_START = new Date("2026-10-01T00:00:30.000Z");
const LEASE_MS = 300_000;

const path = (action: "plan_generation" | "nutrition_plan_generation", period: string) =>
  `${QUOTA_COLLECTION}/${quotaDocId(UID, action, period)}`;

const harness = (start: Date) => {
  const db = fakeFirestore() as unknown as FakeFirestore & import("firebase-admin/firestore").Firestore;
  let at = start.getTime();
  const store = createFirestoreQuotaStore({ firestore: db, now: () => new Date(at) });
  const inTx = <T>(body: (tx: QuotaTransactionLike) => Promise<T>) =>
    db.runTransaction((tx) => body(tx as unknown as QuotaTransactionLike));
  return {
    db,
    store,
    inTx,
    set: (date: Date) => {
      at = date.getTime();
    },
    doc: (action: "plan_generation" | "nutrition_plan_generation", period: string) =>
      db.docs.get(path(action, period)) as { count?: number; period?: string; reservations?: Array<{ requestId: string; expiresAt: string }> } | undefined,
  };
};

const expiry = (from: Date) => new Date(from.getTime() + LEASE_MS);

describe("the ledger: one read, then writes only", () => {
  it("settles a hold after the caller's other writes without reading again", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx(async (tx) => {
      const ledger = await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation" });
      // Another document written first: the fake, like Firestore, refuses any read from here on.
      tx.set({ path: "elsewhere/doc" }, { written: true });
      expect(ledger.reserve({ requestId: "r1", limit: 4, expiresAt: expiry(SEPTEMBER_END) })).toBe(1);
    });
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [{ requestId: "r1" }] });
  });

  it("the fake refuses a read after a write, as Firestore does", async () => {
    const h = harness(SEPTEMBER_END);
    await expect(
      h.inTx(async (tx) => {
        tx.set({ path: "elsewhere/doc" }, { written: true });
        await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation" });
      })
    ).rejects.toThrow(/reads to be executed before all writes/);
  });

  it("applies several changes to one document cumulatively: a released hold pays for a new one at the limit", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx(async (tx) => {
      const ledger = await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation" });
      for (const id of ["a", "b", "c", "d"]) ledger.reserve({ requestId: id, limit: 4, expiresAt: expiry(SEPTEMBER_END) });
    });
    await h.inTx(async (tx) => {
      const ledger = await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation" });
      expect(ledger.reserve({ requestId: "e", limit: 4, expiresAt: expiry(SEPTEMBER_END) })).toBeNull();
      ledger.release("a");
      expect(ledger.reserve({ requestId: "e", limit: 4, expiresAt: expiry(SEPTEMBER_END) })).toBe(4);
    });
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 4 });
    expect(h.doc("nutrition_plan_generation", "2026-09")?.reservations?.map((entry) => entry.requestId)).toEqual(["b", "c", "d", "e"]);
  });

  it("refuses a period that is not a UTC calendar month", async () => {
    const h = harness(SEPTEMBER_END);
    for (const period of ["2026-9", "2026-13", "september", "2026-09-30", ""]) {
      await expect(
        h.inTx((tx) => h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", period }))
      ).rejects.toThrow(/YYYY-MM/);
    }
  });
});

describe("the ledger: reserve, renew, consume, release", () => {
  const reserve = (h: ReturnType<typeof harness>, requestId: string, at: Date, renew = false) =>
    h.inTx(async (tx) =>
      (await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", period: "2026-09" })).reserve({
        requestId,
        limit: DEFAULT_QUOTA_LIMITS.nutrition_plan_generation,
        expiresAt: expiry(at),
        renew,
      })
    );
  const settle = (h: ReturnType<typeof harness>, how: "consume" | "release", requestId: string) =>
    h.inTx(async (tx) => {
      (await h.store.readLedgerInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", period: "2026-09" }))[how](requestId);
    });

  it("reserving the same request twice holds one unit", async () => {
    const h = harness(SEPTEMBER_END);
    expect(await reserve(h, "r1", SEPTEMBER_END)).toBe(1);
    expect(await reserve(h, "r1", SEPTEMBER_END)).toBe(1);
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [{ requestId: "r1" }] });
  });

  it("concurrent reservations for different requests never exceed the limit", async () => {
    const h = harness(SEPTEMBER_END);
    const results = await Promise.all(["a", "b", "c", "d", "e", "f"].map((id) => reserve(h, id, SEPTEMBER_END)));
    expect(results.filter((result) => result !== null)).toHaveLength(4);
    expect(results.filter((result) => result === null)).toHaveLength(2);
    expect(h.doc("nutrition_plan_generation", "2026-09")?.count).toBe(4);
  });

  it("renew keeps a request's own expired hold as the same unit, even at the limit; without renew it would be reclaimed first", async () => {
    const h = harness(SEPTEMBER_END);
    for (const id of ["a", "b", "c", "d"]) await reserve(h, id, SEPTEMBER_END);
    await settle(h, "consume", "a");
    await settle(h, "consume", "b");
    await settle(h, "consume", "c");
    // d's hold has expired.
    const later = new Date(SEPTEMBER_END.getTime() + LEASE_MS + 1);
    h.set(later);
    expect(await reserve(h, "d", later, true)).toBe(4);
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({
      count: 4,
      reservations: [{ requestId: "d", expiresAt: expiry(later).toISOString() }],
    });
  });

  it("consume keeps the count and drops the hold; a later consume or release changes nothing", async () => {
    const h = harness(SEPTEMBER_END);
    await reserve(h, "r1", SEPTEMBER_END);
    await settle(h, "consume", "r1");
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [] });
    await settle(h, "consume", "r1");
    await settle(h, "release", "r1");
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [] });
  });

  it("release is idempotent and never takes the count below zero", async () => {
    const h = harness(SEPTEMBER_END);
    await reserve(h, "r1", SEPTEMBER_END);
    await settle(h, "release", "r1");
    await settle(h, "release", "r1");
    await settle(h, "release", "never-held");
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 0, reservations: [] });
  });

  it("a release finds only its own hold: another request's unit is never refunded", async () => {
    const h = harness(SEPTEMBER_END);
    await reserve(h, "mine", SEPTEMBER_END);
    await reserve(h, "theirs", SEPTEMBER_END);
    await settle(h, "release", "mine");
    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [{ requestId: "theirs" }] });
  });
});

describe("an explicit period across the UTC month boundary", () => {
  it("a September hold is consumed in October in September's document, and October's is never written", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx((tx) =>
      h.store.reserveInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", requestId: "r1", limit: 4, expiresAt: expiry(SEPTEMBER_END), period: "2026-09" })
    );
    h.set(OCTOBER_START);
    await h.inTx((tx) => h.store.consumeInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", requestId: "r1", period: "2026-09" }));

    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ period: "2026-09", count: 1, reservations: [] });
    expect(h.doc("nutrition_plan_generation", "2026-10")).toBeUndefined();
    expect(h.store.currentPeriod()).toBe("2026-10");
  });

  it("a September hold is released in October in September's document", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx((tx) =>
      h.store.reserveInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", requestId: "r1", limit: 4, expiresAt: expiry(SEPTEMBER_END), period: "2026-09" })
    );
    h.set(OCTOBER_START);
    await h.inTx((tx) => h.store.releaseInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", requestId: "r1", period: "2026-09" }));

    expect(h.doc("nutrition_plan_generation", "2026-09")).toMatchObject({ count: 0, reservations: [] });
    expect(h.doc("nutrition_plan_generation", "2026-10")).toBeUndefined();
  });
});

describe("Training's use of the store is unchanged", () => {
  it("without a period, every call counts against the month of the store's clock — as before NUT-12C.2", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx((tx) =>
      h.store.reserveInTransaction(tx, { uid: UID, action: "plan_generation", requestId: "w1", limit: 3, expiresAt: expiry(SEPTEMBER_END) })
    );
    expect(h.doc("plan_generation", "2026-09")).toMatchObject({ period: "2026-09", count: 1, reservations: [{ requestId: "w1" }] });

    // After the boundary a period-less call reads October's document, exactly as it always has.
    h.set(OCTOBER_START);
    await h.inTx((tx) => h.store.consumeInTransaction(tx, { uid: UID, action: "plan_generation", requestId: "w1" }));
    expect(h.doc("plan_generation", "2026-10")).toMatchObject({ period: "2026-10", count: 0, reservations: [] });
    expect(h.doc("plan_generation", "2026-09")).toMatchObject({ count: 1, reservations: [{ requestId: "w1" }] });
  });

  it("keeps Training's and Nutrition's allowances in separate documents", async () => {
    const h = harness(SEPTEMBER_END);
    await h.inTx((tx) =>
      h.store.reserveInTransaction(tx, { uid: UID, action: "plan_generation", requestId: "same-id", limit: 3, expiresAt: expiry(SEPTEMBER_END) })
    );
    await h.inTx((tx) =>
      h.store.reserveInTransaction(tx, { uid: UID, action: "nutrition_plan_generation", requestId: "same-id", limit: 4, expiresAt: expiry(SEPTEMBER_END) })
    );
    expect(h.doc("plan_generation", "2026-09")?.count).toBe(1);
    expect(h.doc("nutrition_plan_generation", "2026-09")?.count).toBe(1);
    expect(await h.store.getUsage(UID, "plan_generation")).toBe(1);
    expect(await h.store.getUsage(UID, "nutrition_plan_generation")).toBe(1);
  });
});
