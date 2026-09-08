import { describe, it, expect } from "vitest";
import { handleGenerateWorkoutPlan, type PlanGenerationDeps } from "./generatePlan";
import {
  createFirestoreQuotaStore,
  QUOTA_COLLECTION,
  quotaPeriod,
} from "../quota/firestoreQuotaStore";
import {
  CLAIM_LEASE_MS,
  createFirestoreOperationStore,
  OPERATION_COLLECTION,
  operationDocId,
} from "../idempotency";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import { fakeFirestore, type FakeFirestore } from "../testing/fakeFirestore";
import type { GeminiProvider, ProviderResult } from "./providers/gemini";

/*
  One press of the button, interrupted everywhere it can be interrupted.

  The property under test is not "the happy path works" — that is covered next
  door in generatePlan.test.ts. It is that a single logical request converges
  on at most one persisted plan and at most one charge against a
  three-per-month quota no matter where it is cut off: a lost response, a
  browser that gave up, a duplicated invocation, a process killed after the
  model answered, a bookkeeping write that failed, or two invocations racing
  for the same id.

  Every test below drives the real handler through the real stores against an
  in-memory Firestore, so what is asserted is the production orchestration and
  not a description of it.
*/

const UID = "alice";
const OTHER_UID = "mallory";
const REQUEST_ID = "3f1a6f28-9c4e-4a1b-8f2d-77c0b5e1a9d4";
const OTHER_REQUEST_ID = "8b2c1d40-5e6f-4a7b-9c8d-0e1f2a3b4c5d";
const START = new Date("2026-08-27T10:00:00.000Z");

const COMPLETE_PROFILE = {
  fullName: "Alice Beispiel",
  email: "alice@example.com",
  fitnessGoal: "gainMuscle",
  experienceLevel: "intermediate",
  equipment: ["dumbbells", "pullup_bar"],
  daysPerWeek: 3,
  sessionMinutes: 60,
  role: "user",
};

const DAY_LABELS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const planWeek = () =>
  DAY_LABELS.map((day, index) =>
    index === 0 || index === 2 || index === 4
      ? {
          day,
          exercises: [
            { name: "Kurzhantel-Schulterdrücken", sets: 4, reps: "8-10" },
            { name: "Klimmzüge", sets: 3, reps: "6-8" },
          ],
        }
      : { day, exercises: [] }
  );

const validPlan = () => ({
  "Week 1": planWeek(),
  "Week 2": planWeek(),
  "Week 3": planWeek(),
  "Week 4": planWeek(),
});

interface Harness {
  db: FakeFirestore;
  deps: PlanGenerationDeps;
  /** Every provider call, so "did this cost money again?" is answerable. */
  providerCalls: number;
  /** Moves the clock, to age a claim past its lease. */
  advance(ms: number): void;
  clock(): Date;
  /** Plan ids handed out, in order, so a reused one is visible. */
  mintedPlanIds: string[];
}

const harness = (
  options: {
    profile?: Record<string, unknown> | null;
    responses?: Array<unknown | Error>;
    failWrites?: (path: string) => boolean;
    log?: (entry: unknown) => Promise<void>;
    uids?: string[];
  } = {}
): Harness => {
  const db = fakeFirestore({ failWrites: options.failWrites });
  for (const uid of options.uids ?? [UID]) {
    if (options.profile !== null) db.docs.set("users/" + uid, { ...(options.profile ?? COMPLETE_PROFILE) });
  }

  let at = new Date(START);
  const now = () => new Date(at);
  const responses = options.responses ?? [validPlan()];
  const state = { providerCalls: 0 };
  const mintedPlanIds: string[] = [];

  const provider: GeminiProvider = {
    id: "google-gemini",
    generatePlanWithUsage: async (): Promise<ProviderResult> => {
      const index = state.providerCalls;
      state.providerCalls += 1;
      const response = responses[Math.min(index, responses.length - 1)];
      if (response instanceof Error) throw response;
      return { output: response, usage: {} };
    },
    generatePlan: async () => undefined,
    summariseWeeklyReviewWithUsage: async () => ({ output: undefined, usage: {} }),
    summariseWeeklyReview: async () => undefined,
  };

  const deps: PlanGenerationDeps = {
    firestore: db,
    provider,
    quota: createFirestoreQuotaStore({ firestore: db, now }),
    operations: createFirestoreOperationStore(db, now),
    log: (options.log ?? (async () => undefined)) as PlanGenerationDeps["log"],
    now,
    newPlanId: () => {
      const id = `plan-${mintedPlanIds.length + 1}`;
      mintedPlanIds.push(id);
      return id;
    },
  };

  return {
    db,
    deps,
    get providerCalls() {
      return state.providerCalls;
    },
    advance: (ms) => {
      at = new Date(at.getTime() + ms);
    },
    clock: now,
    mintedPlanIds,
  };
};

const call = (
  h: Harness,
  over: { uid?: string; requestId?: string } = {}
): ReturnType<typeof handleGenerateWorkoutPlan> =>
  handleGenerateWorkoutPlan(
    {
      auth: { uid: over.uid ?? UID },
      data: { requestId: over.requestId ?? REQUEST_ID },
    },
    h.deps
  );

const plans = (h: Harness, uid: string = UID) => h.db.under(`users/${uid}/workout_plans`);

const quotaCount = (h: Harness, uid: string = UID): number => {
  const doc = h.db.docs.get(
    `${QUOTA_COLLECTION}/${uid}__plan_generation__${quotaPeriod(h.clock())}`
  );
  return (doc?.count as number) ?? 0;
};

const operation = (h: Harness, uid: string = UID, requestId: string = REQUEST_ID) =>
  h.db.docs.get(`${OPERATION_COLLECTION}/${operationDocId(uid, requestId)}`);

/** Take the claim the way the handler does, then walk away from it. */
const claimAndAbandon = async (h: Harness, requestId: string = REQUEST_ID) =>
  h.deps.operations.claim({
    uid: UID,
    requestId,
    mintPlanId: () => "abandoned-plan",
    reserveQuota: async (tx) =>
      (await h.deps.quota.reserveInTransaction(
        tx,
        UID,
        "plan_generation",
        DEFAULT_QUOTA_LIMITS.plan_generation
      )) !== null,
  });

describe("one logical request, one plan, one charge", () => {
  it("returns the first call's plan for a repeated request id without generating again", async () => {
    const h = harness();
    const first = await call(h);
    const second = await call(h);

    expect(second.planId).toBe(first.planId);
    expect(second.replay).toBe(true);
    expect(h.providerCalls).toBe(1);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
  });

  it("charges a replay nothing, however many times the response is lost", async () => {
    const h = harness();
    await call(h);
    await call(h);
    await call(h);

    expect(quotaCount(h)).toBe(1);
    expect(plans(h)).toHaveLength(1);
  });

  it("keeps two simultaneous calls with the same id to one generation", async () => {
    const h = harness();
    const [first, second] = await Promise.allSettled([call(h), call(h)]);

    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const refused = [first, second].find((r) => r.status === "rejected");
    expect(refused && (refused as PromiseRejectedResult).reason).toMatchObject({
      code: "REQUEST_IN_PROGRESS",
    });

    expect(h.providerCalls).toBe(1);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
  });

  it("refuses to start a second generation while a claim is live", async () => {
    const h = harness();
    await claimAndAbandon(h);

    await expect(call(h)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    expect(h.providerCalls).toBe(0);
    expect(plans(h)).toHaveLength(0);
  });
});

describe("the plan and its bookkeeping cannot disagree", () => {
  /*
    The regression this file exists for. Persisting the plan and recording that
    the request produced it used to be two writes: when the second failed, the
    plan stayed on disk, the quota reservation was handed back, and the record
    said the request had failed — so the next retry generated a second plan and
    the user held two plans for one press and had been charged for neither.
  */
  it("leaves no plan behind when the completion record cannot be written", async () => {
    let operationWrites = 0;
    const h = harness({
      // The claim's write is the first; the finalisation's is the second.
      failWrites: (path) => path.startsWith(OPERATION_COLLECTION) && (operationWrites += 1) === 2,
    });

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.status).toBe("failed");
    expect(quotaCount(h)).toBe(0);
  });

  it("still ends with one plan when that failure is retried with the same id", async () => {
    let operationWrites = 0;
    const h = harness({
      failWrites: (path) => path.startsWith(OPERATION_COLLECTION) && (operationWrites += 1) === 2,
    });

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    const retry = await call(h);

    expect(plans(h)).toHaveLength(1);
    expect(plans(h)[0][0]).toBe(`users/${UID}/workout_plans/${retry.planId}`);
    expect(quotaCount(h)).toBe(1);
  });

  it("leaves nothing behind when the plan document itself is refused", async () => {
    const h = harness({ failWrites: (path) => path.includes("/workout_plans/") });

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.status).toBe("failed");
    expect(quotaCount(h)).toBe(0);
  });

  it("reuses the plan id the failed attempt reserved, so no second document can appear", async () => {
    const h = harness({ failWrites: (path) => path.includes("/workout_plans/") });
    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    const reserved = operation(h)?.planId;

    // Writes are allowed again; the retry continues the same request.
    const h2 = h;
    (h2.db as unknown as { options: { failWrites?: (p: string) => boolean } }).options.failWrites =
      undefined;
    const retry = await call(h2);

    expect(retry.planId).toBe(reserved);
    expect(plans(h)).toHaveLength(1);
  });
});

describe("a plan that exists is never unmade", () => {
  it("stays a success when the telemetry write fails afterwards", async () => {
    const h = harness({
      log: async () => {
        throw new Error("log sink unavailable");
      },
    });

    const result = await call(h);

    expect(result.ok).toBe(true);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(operation(h)?.status).toBe("completed");
  });

  it("stays a success when the telemetry writer throws rather than rejecting", async () => {
    // A synchronous throw walks straight past `.catch()` and into the
    // handler's failure path, which must no longer be able to undo a plan.
    const h = harness();
    h.deps.log = (() => {
      throw new Error("log sink exploded");
    }) as PlanGenerationDeps["log"];

    const result = await call(h);

    expect(result.ok).toBe(true);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(operation(h)?.status).toBe("completed");
  });

  it("stays a success when reading the quota summary afterwards fails", async () => {
    const h = harness();
    h.deps.quota.getUsage = async () => {
      throw new Error("read unavailable");
    };

    const result = await call(h);

    expect(result.planId).toBeTruthy();
    expect(plans(h)).toHaveLength(1);
    expect(operation(h)?.status).toBe("completed");
  });

  it("refuses to mark a completed request failed, even from its own claim", async () => {
    const h = harness();
    const done = await call(h);

    await h.deps.operations.fail({
      uid: UID,
      requestId: REQUEST_ID,
      claimToken: operation(h)?.claimToken as string,
      releaseQuota: (tx) => h.deps.quota.releaseInTransaction(tx, UID, "plan_generation"),
    });

    expect(operation(h)?.status).toBe("completed");
    expect(operation(h)?.planId).toBe(done.planId);
    expect(quotaCount(h)).toBe(1);
  });
});

describe("an abandoned request recovers", () => {
  it("stays another invocation's business until the lease runs out", async () => {
    const h = harness();
    await claimAndAbandon(h);

    h.advance(CLAIM_LEASE_MS - 1000);
    await expect(call(h)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    expect(h.providerCalls).toBe(0);
  });

  it("can be taken over once the lease has expired", async () => {
    const h = harness();
    await claimAndAbandon(h);

    h.advance(CLAIM_LEASE_MS + 1000);
    const result = await call(h);

    expect(result.ok).toBe(true);
    expect(plans(h)).toHaveLength(1);
    expect(operation(h)?.status).toBe("completed");
  });

  it("does not charge the takeover a second time", async () => {
    const h = harness();
    await claimAndAbandon(h);
    expect(quotaCount(h)).toBe(1);

    h.advance(CLAIM_LEASE_MS + 1000);
    await call(h);

    // One press, one charge — even though two invocations claimed it.
    expect(quotaCount(h)).toBe(1);
  });

  it("continues the dead attempt's plan id rather than starting a new document", async () => {
    const h = harness();
    const claimed = await claimAndAbandon(h);
    expect(claimed.kind).toBe("claimed");

    h.advance(CLAIM_LEASE_MS + 1000);
    const result = await call(h);

    expect(result.planId).toBe("abandoned-plan");
    expect(plans(h).map(([path]) => path)).toEqual([
      `users/${UID}/workout_plans/abandoned-plan`,
    ]);
  });

  it("does not let the superseded invocation write over the winner's plan", async () => {
    const h = harness();
    const stale = await claimAndAbandon(h);
    expect(stale.kind).toBe("claimed");
    const staleToken = (stale as { claimToken: string }).claimToken;

    h.advance(CLAIM_LEASE_MS + 1000);
    const winner = await call(h);

    // The abandoned invocation wakes up and tries to finish its own work.
    const outcome = await h.deps.operations.finalize({
      uid: UID,
      requestId: REQUEST_ID,
      claimToken: staleToken,
      writeResult: (tx, planId) => {
        tx.create(
          h.db.collection("users").doc(UID).collection("workout_plans").doc(planId),
          { content: {}, source: "stale" }
        );
      },
    });

    expect(outcome).toEqual({ kind: "superseded", planId: winner.planId });
    expect(plans(h)).toHaveLength(1);
    expect(plans(h)[0][1].source).toBe("ai");
    expect(quotaCount(h)).toBe(1);
  });
});

describe("crash matrix", () => {
  it("A: killed before the provider — recoverable, one plan, one charge", async () => {
    const h = harness();
    await claimAndAbandon(h);
    h.advance(CLAIM_LEASE_MS + 1000);

    await call(h);

    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(h.providerCalls).toBe(1);
  });

  it("B: killed after the model answered, before the plan was written", async () => {
    // The provider answers, the write is refused, the process reports failure.
    const h = harness({ failWrites: (path) => path.includes("/workout_plans/") });
    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(plans(h)).toHaveLength(0);

    (h.db as unknown as { options: { failWrites?: (p: string) => boolean } }).options.failWrites =
      undefined;
    await call(h);

    // Regenerated, because nothing was kept — but still exactly one plan.
    expect(h.providerCalls).toBe(2);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
  });

  it("C: the finalisation transaction fails before committing — no partial state", async () => {
    let operationWrites = 0;
    const h = harness({
      failWrites: (path) => path.startsWith(OPERATION_COLLECTION) && (operationWrites += 1) === 2,
    });

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.status).not.toBe("completed");
    expect(quotaCount(h)).toBe(0);
  });

  it("D: committed, then the response is lost — the retry reconciles", async () => {
    const h = harness();
    const first = await call(h);

    // The browser never saw that. It asks again with the same id.
    const retry = await call(h);

    expect(retry.planId).toBe(first.planId);
    expect(retry.replay).toBe(true);
    expect(h.providerCalls).toBe(1);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
  });

  it("E: the user retries an uncertain request rather than starting a new one", async () => {
    const h = harness();
    const first = await call(h);
    const again = await call(h);

    expect(again.planId).toBe(first.planId);
    expect(plans(h)).toHaveLength(1);
  });

  it("F: the same id invoked concurrently twice yields one generation", async () => {
    const h = harness();
    await Promise.allSettled([call(h), call(h), call(h)]);

    expect(h.providerCalls).toBe(1);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
  });
});

describe("quota is charged for what was produced, and only that", () => {
  it("charges nothing for a generation that produced no plan", async () => {
    const h = harness({ responses: [new Error("provider down")] });

    await expect(call(h)).rejects.toMatchObject({ code: "INTERNAL" });

    expect(quotaCount(h)).toBe(0);
    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.quotaCharged).toBe(false);
  });

  it("charges nothing for a profile that is not finished, and claims nothing", async () => {
    const h = harness({ profile: { fullName: "Alice", email: "a@example.com", role: "user" } });

    await expect(call(h)).rejects.toMatchObject({ code: "PROFILE_INCOMPLETE" });

    expect(quotaCount(h)).toBe(0);
    expect(operation(h)).toBeUndefined();
    expect(h.providerCalls).toBe(0);
  });

  it("lets a genuinely new request use a new id and charge again", async () => {
    const h = harness();
    await call(h);
    const second = await call(h, { requestId: OTHER_REQUEST_ID });

    expect(second.replay).toBe(false);
    expect(h.providerCalls).toBe(2);
    expect(plans(h)).toHaveLength(2);
    expect(quotaCount(h)).toBe(2);
  });

  it("refuses a new request id once the month's allowance is gone, without claiming it", async () => {
    const h = harness();
    const ids = [
      REQUEST_ID,
      OTHER_REQUEST_ID,
      "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
      "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a",
    ];
    for (const requestId of ids.slice(0, 3)) await call(h, { requestId });

    await expect(call(h, { requestId: ids[3] })).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });

    expect(quotaCount(h)).toBe(3);
    expect(plans(h)).toHaveLength(3);
    expect(h.providerCalls).toBe(3);
    expect(operation(h, UID, ids[3])).toBeUndefined();
  });
});

describe("a request id belongs to the account that sent it", () => {
  it("gives one user's id no reach into another user's operation", async () => {
    const h = harness({ uids: [UID, OTHER_UID] });
    const mine = await call(h);

    const theirs = await call(h, { uid: OTHER_UID });

    expect(theirs.planId).not.toBe(mine.planId);
    expect(theirs.replay).toBe(false);
    expect(plans(h, OTHER_UID)).toHaveLength(1);
    expect(plans(h, UID)).toHaveLength(1);
    expect(quotaCount(h, UID)).toBe(1);
    expect(quotaCount(h, OTHER_UID)).toBe(1);
  });

  it("records each account's operation under its own document", async () => {
    const h = harness({ uids: [UID, OTHER_UID] });
    await call(h);
    await call(h, { uid: OTHER_UID });

    expect(operation(h, UID)?.uid).toBe(UID);
    expect(operation(h, OTHER_UID)?.uid).toBe(OTHER_UID);
    expect(operation(h, UID)?.planId).not.toBe(operation(h, OTHER_UID)?.planId);
  });

  it("never lets a plan id be predicted from the request id the client chose", async () => {
    const h = harness({ uids: [UID, OTHER_UID] });
    const result = await call(h);

    expect(result.planId).not.toContain(REQUEST_ID);
    expect(operation(h)?.planId).not.toContain(REQUEST_ID);
  });
});

describe("the request id is validated before it is trusted", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a uuid", "../../users/mallory"],
    ["a path segment", "alice__plan"],
    ["far too long", "a".repeat(2000)],
    ["a number", 42],
    ["an object", { toString: () => REQUEST_ID }],
  ])("refuses %s", async (_label, requestId) => {
    const h = harness();

    await expect(
      handleGenerateWorkoutPlan({ auth: { uid: UID }, data: { requestId } }, h.deps)
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(h.providerCalls).toBe(0);
    expect(h.db.under(OPERATION_COLLECTION)).toHaveLength(0);
    expect(quotaCount(h)).toBe(0);
  });
});
