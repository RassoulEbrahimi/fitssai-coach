import { describe, it, expect } from "vitest";
import { CLAIM_LEASE_MS, createFirestoreOperationStore, operationDocId } from "./idempotency";
import {
  NUTRITION_PLAN_OPERATIONS,
  OPERATION_COLLECTION,
  OperationNamespaceConflictError,
  WORKOUT_PLAN_OPERATIONS,
  createOperationRecordStore,
  type OperationRecordTransaction,
} from "./operationRecords";
import { fakeFirestore } from "./testing/fakeFirestore";

/*
  NUT-11: `_ai_operations` generalised for a second operation family without
  moving the first. Workout records keep their ids and their exact fields;
  Nutrition records live under their own namespace; a record of one family is
  never read as the other's.

  Workout's own behaviour — replay, quota reserve/consume/release, lease and
  takeover, a completed record that cannot be reopened — stays pinned by
  coaching/planIdempotency.test.ts and coaching/generatePlan.test.ts, which
  run unchanged against the adapter.
*/

const UID = "alice";
const RID = "3f1a6f28-9c4e-4a1b-8f2d-77c0b5e1a9d4";
const NOW = new Date("2026-09-28T09:15:00.000Z");

const tx = (db: ReturnType<typeof fakeFirestore>) => <T>(body: (t: OperationRecordTransaction) => Promise<T>) =>
  (db as unknown as { runTransaction: (fn: (t: OperationRecordTransaction) => Promise<T>) => Promise<T> }).runTransaction(body);

describe("operation record ids", () => {
  it("keeps every Workout record at the id it always had", () => {
    expect(operationDocId(UID, RID)).toBe(`alice__${RID}`);
    expect(WORKOUT_PLAN_OPERATIONS.docId(UID, RID.toUpperCase())).toBe(`alice__${RID}`);
    expect(WORKOUT_PLAN_OPERATIONS.recordTag).toBeUndefined();
    expect(OPERATION_COLLECTION).toBe("_ai_operations");
  });

  it("files a Nutrition record under its own namespace, so the same UUID is two operations", () => {
    expect(NUTRITION_PLAN_OPERATIONS.docId(UID, RID)).toBe(`nutritionPlan__alice__${RID}`);
    expect(NUTRITION_PLAN_OPERATIONS.docId(UID, RID)).not.toBe(WORKOUT_PLAN_OPERATIONS.docId(UID, RID));
    expect(NUTRITION_PLAN_OPERATIONS.recordTag).toBe("nutritionPlan");
  });

  it("keeps the Workout lease exactly as it was", () => {
    expect(CLAIM_LEASE_MS).toBe(240_000);
  });
});

describe("the Workout adapter writes what it always wrote", () => {
  it("claims, completes and fails with the historical field set and no namespace field", async () => {
    const db = fakeFirestore();
    const store = createFirestoreOperationStore(db, () => NOW);
    const path = `${OPERATION_COLLECTION}/alice__${RID}`;

    const claim = await store.claim({ uid: UID, requestId: RID, mintPlanId: () => "plan-w", reserveQuota: async () => true });
    expect(claim).toMatchObject({ kind: "claimed", planId: "plan-w" });
    expect(Object.keys(db.docs.get(path) ?? {}).sort()).toEqual(
      ["attempts", "claimToken", "claimedAt", "leaseExpiresAt", "planId", "quotaCharged", "startedAt", "status", "uid"].sort()
    );
    expect(db.docs.get(path)).toMatchObject({
      uid: UID,
      status: "in_progress",
      planId: "plan-w",
      quotaCharged: true,
      attempts: 1,
      startedAt: NOW.toISOString(),
      claimedAt: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + CLAIM_LEASE_MS).toISOString(),
    });

    await store.fail({ uid: UID, requestId: RID, claimToken: (claim as { claimToken: string }).claimToken, releaseQuota: async () => undefined });
    expect(db.docs.get(path)).toMatchObject({ status: "failed", quotaCharged: false, claimToken: null, leaseExpiresAt: null, failedAt: NOW.toISOString() });
    expect(db.docs.get(path)).not.toHaveProperty("namespace");

    // A failed Workout request is retried under the same id, keeping its plan id.
    const retry = await store.claim({ uid: UID, requestId: RID, mintPlanId: () => "plan-other", reserveQuota: async () => true });
    expect(retry).toMatchObject({ kind: "claimed", planId: "plan-w" });
    const finalized = await store.finalize({
      uid: UID,
      requestId: RID,
      claimToken: (retry as { claimToken: string }).claimToken,
      consumeQuota: async () => undefined,
      writeResult: () => undefined,
    });
    expect(finalized).toEqual({ kind: "committed", planId: "plan-w" });
    expect(db.docs.get(path)).toMatchObject({ status: "completed", planId: "plan-w", quotaCharged: true, completedAt: NOW.toISOString(), leaseExpiresAt: null, attempts: 2 });
    expect(Object.keys(db.docs.get(path) ?? {})).not.toContain("namespace");

    // Completed stays completed: a replay, never a reopening.
    expect(await store.claim({ uid: UID, requestId: RID, mintPlanId: () => "x", reserveQuota: async () => true })).toEqual({ kind: "replay", planId: "plan-w" });
  });

  it("reads a historical Workout record exactly as before", async () => {
    const db = fakeFirestore();
    db.docs.set(`${OPERATION_COLLECTION}/alice__${RID}`, { uid: UID, status: "completed", planId: "plan-old", quotaCharged: true, attempts: 1 });
    const store = createFirestoreOperationStore(db, () => NOW);
    expect(await store.claim({ uid: UID, requestId: RID, mintPlanId: () => "x", reserveQuota: async () => true })).toEqual({ kind: "replay", planId: "plan-old" });
  });
});

describe("families never read each other's records", () => {
  it("Nutrition activity leaves a Workout record of the same UUID untouched", async () => {
    const db = fakeFirestore();
    const workout = createFirestoreOperationStore(db, () => NOW);
    await workout.claim({ uid: UID, requestId: RID, mintPlanId: () => "plan-w", reserveQuota: async () => true });
    const workoutPath = `${OPERATION_COLLECTION}/alice__${RID}`;
    const before = JSON.stringify(db.docs.get(workoutPath));

    const nutrition = createOperationRecordStore({ firestore: db, namespace: NUTRITION_PLAN_OPERATIONS, leaseMs: 1000 });
    await tx(db)(async (t) => {
      const record = await nutrition.read(t, UID, RID, NOW);
      expect(record.exists).toBe(false);
      nutrition.writeClaim(t, { uid: UID, requestId: RID, previous: record, at: NOW, claimToken: "n-1", planId: "plan-n" });
    });
    await tx(db)(async (t) => nutrition.writeEnded(t, { uid: UID, requestId: RID, at: NOW, status: "discarded" }));

    expect(JSON.stringify(db.docs.get(workoutPath))).toBe(before);
    expect(db.docs.get(`${OPERATION_COLLECTION}/nutritionPlan__alice__${RID}`)).toMatchObject({
      namespace: "nutritionPlan",
      status: "discarded",
      planId: "plan-n",
      claimToken: null,
      leaseExpiresAt: null,
      discardedAt: NOW.toISOString(),
    });
    // A Workout claim of that UUID is still its own business.
    expect(await workout.claim({ uid: UID, requestId: RID, mintPlanId: () => "x", reserveQuota: async () => true })).toEqual({ kind: "in_progress" });
  });

  it("refuses to read a record of another family, rather than replaying it", async () => {
    const db = fakeFirestore();
    // A uid shaped like a namespace prefix would reach a Nutrition record by Workout's id.
    db.docs.set(`${OPERATION_COLLECTION}/nutritionPlan__bob__${RID}`, { namespace: "nutritionPlan", status: "completed", planId: "plan-n" });
    const workout = createFirestoreOperationStore(db, () => NOW);
    await expect(
      workout.claim({ uid: "nutritionPlan__bob", requestId: RID, mintPlanId: () => "x", reserveQuota: async () => true })
    ).rejects.toBeInstanceOf(OperationNamespaceConflictError);

    // And a Nutrition read of an untagged (Workout-shaped) record is refused too.
    db.docs.set(`${OPERATION_COLLECTION}/nutritionPlan__carol__${RID}`, { status: "completed", planId: "plan-w" });
    const nutrition = createOperationRecordStore({ firestore: db, namespace: NUTRITION_PLAN_OPERATIONS, leaseMs: 1000 });
    await expect(tx(db)((t) => nutrition.read(t, "carol", RID, NOW))).rejects.toBeInstanceOf(OperationNamespaceConflictError);
  });
});

describe("the generic record", () => {
  it("takes its lease from the family, and refuses a lease that is not a positive duration", async () => {
    const db = fakeFirestore();
    for (const leaseMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createOperationRecordStore({ firestore: db, namespace: NUTRITION_PLAN_OPERATIONS, leaseMs })).toThrow();
    }
    const store = createOperationRecordStore({ firestore: db, namespace: NUTRITION_PLAN_OPERATIONS, leaseMs: 5000 });
    expect(store.leaseExpiry(NOW).getTime() - NOW.getTime()).toBe(5000);
    await tx(db)(async (t) => {
      const record = await store.read(t, UID, RID, NOW);
      store.writeClaim(t, { uid: UID, requestId: RID, previous: record, at: NOW, claimToken: "n-1", planId: "p" });
    });
    await tx(db)(async (t) => {
      expect((await store.read(t, UID, RID, new Date(NOW.getTime() + 4999))).leaseLive).toBe(true);
      expect((await store.read(t, UID, RID, new Date(NOW.getTime() + 5000))).leaseLive).toBe(false);
    });
  });

  it("ends a request without a result — failed or discarded — without inventing one", async () => {
    const db = fakeFirestore();
    const store = createOperationRecordStore({ firestore: db, namespace: NUTRITION_PLAN_OPERATIONS, leaseMs: 5000 });
    await tx(db)(async (t) => {
      const record = await store.read(t, UID, RID, NOW);
      store.writeClaim(t, { uid: UID, requestId: RID, previous: record, at: NOW, claimToken: "n-1", planId: "reserved" });
    });
    await tx(db)(async (t) => store.writeEnded(t, { uid: UID, requestId: RID, at: NOW, status: "failed" }));
    const record = await tx(db)((t) => store.read(t, UID, RID, NOW));
    expect(record).toMatchObject({ status: "failed", claimToken: undefined, leaseLive: false, planId: "reserved" });
    expect(db.docs.get(`${OPERATION_COLLECTION}/nutritionPlan__alice__${RID}`)).not.toHaveProperty("completedAt");
  });
});
