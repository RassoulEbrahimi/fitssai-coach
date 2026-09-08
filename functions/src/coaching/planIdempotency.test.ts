import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
const THIRD_REQUEST_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const FOURTH_REQUEST_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
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

const quotaPath = (h: Harness, uid: string = UID): string =>
  `${QUOTA_COLLECTION}/${uid}__plan_generation__${quotaPeriod(h.clock())}`;

const quotaCount = (h: Harness, uid: string = UID): number =>
  (h.db.docs.get(quotaPath(h, uid))?.count as number) ?? 0;

const operation = (h: Harness, uid: string = UID, requestId: string = REQUEST_ID) =>
  h.db.docs.get(`${OPERATION_COLLECTION}/${operationDocId(uid, requestId)}`);

/** Take the claim the way the handler does, then walk away from it. */
const claimAndAbandon = async (
  h: Harness,
  requestId: string = REQUEST_ID,
  planId: string = "abandoned-plan"
) =>
  h.deps.operations.claim({
    uid: UID,
    requestId,
    mintPlanId: () => planId,
    reserveQuota: async (tx, leaseExpiresAt) =>
      (await h.deps.quota.reserveInTransaction(tx, {
        uid: UID,
        action: "plan_generation",
        requestId,
        limit: DEFAULT_QUOTA_LIMITS.plan_generation,
        expiresAt: leaseExpiresAt,
      })) !== null,
  });

/** The units the period still has holds recorded against. */
const heldUnits = (h: Harness, uid: string = UID): Array<{ requestId: string }> =>
  (h.db.docs.get(quotaPath(h, uid))?.reservations as Array<{ requestId: string }>) ?? [];

/** What the user is actually allowed to still generate, as the server sees it. */
const effectiveUsage = (h: Harness, uid: string = UID): Promise<number> =>
  h.deps.quota.getUsage(uid, "plan_generation");

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
      releaseQuota: (tx) =>
        h.deps.quota.releaseInTransaction(tx, {
          uid: UID,
          action: "plan_generation",
          requestId: REQUEST_ID,
        }),
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
      consumeQuota: (tx) =>
        h.deps.quota.consumeInTransaction(tx, {
          uid: UID,
          action: "plan_generation",
          requestId: REQUEST_ID,
        }),
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

/*
  The finalisation transaction commits, and the answer never gets back.

  Nothing distinguishes this from a refused commit at the call site — which is
  the whole reason it is dangerous: the handler reports PERSISTENCE_FAILED for
  a request that persisted a plan, completed its record and paid for it.
*/
const loseTheAcknowledgement = (h: Harness): void => {
  const committed = h.deps.operations.finalize;
  let lost = false;
  h.deps.operations = {
    ...h.deps.operations,
    // Once only: the connection that dropped is not the next one.
    finalize: async (input) => {
      const outcome = await committed(input);
      if (lost) return outcome;
      lost = true;
      throw new Error("commit acknowledgement lost");
    },
  };
};

describe("a commit whose acknowledgement was lost", () => {
  it("reports failure over a plan that is on disk, completed and paid for", async () => {
    const h = harness();
    loseTheAcknowledgement(h);

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    // The error is about the answer, not the outcome. Everything committed.
    expect(plans(h)).toHaveLength(1);
    expect(operation(h)?.status).toBe("completed");
    expect(quotaCount(h)).toBe(1);
    // And the failure path did not talk itself into undoing any of it.
    expect(operation(h)?.planId).toBe(plans(h)[0][0].split("/").pop());
    expect(heldUnits(h)).toHaveLength(0);
  });

  it("reconciles when the retry keeps the same request id", async () => {
    const h = harness();
    loseTheAcknowledgement(h);
    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    const retry = await call(h);

    expect(retry.replay).toBe(true);
    expect(retry.planId).toBe(operation(h)?.planId);
    expect(h.providerCalls).toBe(1);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
  });

  /*
    The counterfactual, and the reason PERSISTENCE_FAILED may not be treated as
    a settled outcome by the browser. A client that mints a new id here asks
    for a second generation of something that already succeeded — and gets it.
  */
  it("cannot reconcile anything once the retry has been given a new id", async () => {
    const h = harness();
    loseTheAcknowledgement(h);
    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    await call(h, { requestId: OTHER_REQUEST_ID });

    expect(h.providerCalls).toBe(2);
    expect(plans(h)).toHaveLength(2);
    expect(quotaCount(h)).toBe(2);
  });

  it("recovers by regenerating when the commit really was refused", async () => {
    const h = harness({ failWrites: (path) => path.includes("/workout_plans/") });
    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.status).toBe("failed");
    expect(quotaCount(h)).toBe(0);
    const reserved = operation(h)?.planId;

    (h.db as unknown as { options: { failWrites?: (p: string) => boolean } }).options.failWrites =
      undefined;
    const retry = await call(h);

    // The same id, so the same reserved document — one plan, charged once.
    expect(retry.planId).toBe(reserved);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(heldUnits(h)).toHaveLength(0);
  });
});

/*
  Three *successful* generations a month is the promise. A unit taken by a
  request that was killed before it produced anything is not a generation
  anybody received, so it cannot be allowed to sit on the allowance for the
  rest of the month.

  The unit is given back by the next transaction that reads the document — the
  user's own next request — rather than by anything that has to be scheduled,
  swept or migrated.
*/
describe("an abandoned reservation does not cost a successful generation", () => {
  it("does not spend the month on generations nobody received", async () => {
    const h = harness();
    for (const requestId of [REQUEST_ID, OTHER_REQUEST_ID, THIRD_REQUEST_ID]) {
      await claimAndAbandon(h, requestId, `abandoned-${requestId}`);
    }
    expect(quotaCount(h)).toBe(3);
    expect(plans(h)).toHaveLength(0);

    h.advance(CLAIM_LEASE_MS + 1000);
    const result = await call(h, { requestId: FOURTH_REQUEST_ID });

    expect(result.ok).toBe(true);
    expect(plans(h)).toHaveLength(1);
    // One plan made, one unit spent — not four.
    expect(await effectiveUsage(h)).toBe(1);
    expect(result.quota.remaining).toBe(2);
  });

  it("A: stops counting an abandoned unit the moment its lease runs out", async () => {
    const h = harness();
    await claimAndAbandon(h);
    expect(await effectiveUsage(h)).toBe(1);

    h.advance(CLAIM_LEASE_MS + 1000);

    // Nothing ran, nothing was swept: the unit simply stopped being anyone's.
    expect(await effectiveUsage(h)).toBe(0);

    await call(h, { requestId: OTHER_REQUEST_ID });
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
  });

  it("B: keeps a stale takeover to the one unit the dead attempt held", async () => {
    const h = harness();
    await claimAndAbandon(h);

    h.advance(CLAIM_LEASE_MS + 1000);
    await call(h);

    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
    expect(heldUnits(h)).toHaveLength(0);
  });

  it("C: never reclaims a unit that bought a plan, however long it sits", async () => {
    const h = harness();
    await call(h);

    h.advance(CLAIM_LEASE_MS * 100);

    expect(await effectiveUsage(h)).toBe(1);
    expect(heldUnits(h)).toHaveLength(0);
    // And it still counts against the limit, which is the point.
    await call(h, { requestId: OTHER_REQUEST_ID });
    expect(await effectiveUsage(h)).toBe(2);
  });

  it("D: never reclaims a unit from a claim that is still live", async () => {
    const h = harness();
    await claimAndAbandon(h);

    h.advance(CLAIM_LEASE_MS - 1000);

    expect(await effectiveUsage(h)).toBe(1);
    await expect(call(h)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    expect(quotaCount(h)).toBe(1);
    expect(heldUnits(h).map((entry) => entry.requestId)).toEqual([REQUEST_ID]);
  });

  it("E: gives a request's unit back once, however often it is released", async () => {
    const h = harness();
    await claimAndAbandon(h);
    expect(quotaCount(h)).toBe(1);

    const release = () =>
      h.db.runTransaction((tx) =>
        h.deps.quota.releaseInTransaction(tx, {
          uid: UID,
          action: "plan_generation",
          requestId: REQUEST_ID,
        })
      );

    await release();
    expect(quotaCount(h)).toBe(0);

    await release();
    await release();

    // A refund it never paid for would be a free generation.
    expect(quotaCount(h)).toBe(0);
    expect(await effectiveUsage(h)).toBe(0);
  });

  it("F: cannot go below zero, however many units are reclaimed at once", async () => {
    const h = harness();
    for (const requestId of [REQUEST_ID, OTHER_REQUEST_ID, THIRD_REQUEST_ID]) {
      await claimAndAbandon(h, requestId, `abandoned-${requestId}`);
    }
    const stale = heldUnits(h);

    h.advance(CLAIM_LEASE_MS + 1000);
    expect(await effectiveUsage(h)).toBe(0);

    // And a record claiming more holds than it has units is still floored.
    h.db.docs.set(quotaPath(h), {
      uid: UID,
      action: "plan_generation",
      count: 1,
      reservations: stale,
    });

    expect(await effectiveUsage(h)).toBe(0);
    await call(h, { requestId: FOURTH_REQUEST_ID });
    expect(quotaCount(h)).toBeGreaterThanOrEqual(0);
    expect(await effectiveUsage(h)).toBe(1);
  });

  it("G: reclaims within a period, and a new month starts clean", async () => {
    const h = harness();
    await claimAndAbandon(h);
    expect(quotaPath(h)).toContain("2026-08");

    h.advance(31 * 24 * 60 * 60 * 1000);

    expect(quotaPath(h)).toContain("2026-09");
    expect(await effectiveUsage(h)).toBe(0);

    const result = await call(h, { requestId: OTHER_REQUEST_ID });
    expect(result.quota.period).toBe("2026-09");
    expect(result.quota.remaining).toBe(2);
  });

  /*
    Reclaiming must not become a way to generate for free. Once a unit has gone
    back, the request that abandoned it is an ordinary new request: if it comes
    back it pays again, exactly like any other press of the button.
  */
  it("charges again when a request revives after its unit went back", async () => {
    const h = harness();
    await claimAndAbandon(h);

    h.advance(CLAIM_LEASE_MS + 1000);
    await call(h, { requestId: OTHER_REQUEST_ID });
    expect(await effectiveUsage(h)).toBe(1);

    await call(h);

    expect(plans(h)).toHaveLength(2);
    expect(await effectiveUsage(h)).toBe(2);
  });

  it("still refuses a fourth generation when three really did succeed", async () => {
    const h = harness();
    for (const requestId of [REQUEST_ID, OTHER_REQUEST_ID, THIRD_REQUEST_ID]) {
      await call(h, { requestId });
    }

    h.advance(CLAIM_LEASE_MS * 10);

    await expect(call(h, { requestId: FOURTH_REQUEST_ID })).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect(plans(h)).toHaveLength(3);
  });

  it("does not let a dead claim refund the unit its successor is using", async () => {
    const h = harness();
    const stale = await claimAndAbandon(h);
    const staleToken = (stale as { claimToken: string }).claimToken;

    h.advance(CLAIM_LEASE_MS + 1000);
    await call(h);

    // The abandoned invocation wakes up and reports its own failure.
    await h.deps.operations.fail({
      uid: UID,
      requestId: REQUEST_ID,
      claimToken: staleToken,
      releaseQuota: (tx) =>
        h.deps.quota.releaseInTransaction(tx, {
          uid: UID,
          action: "plan_generation",
          requestId: REQUEST_ID,
        }),
    });

    expect(operation(h)?.status).toBe("completed");
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
  });
});

/*
  A claim that has outlived its lease is not allowed to finish.

  The token says who claimed the request; it cannot say whether the claim is
  still current. That distinction only started to matter when the quota
  reservation moved onto the quota document, where an unrelated request is
  entitled to reclaim it once it expires — at which point a commit here would
  write a plan that nothing is charged for. The execution budget makes that
  unreachable in production; the lease check makes it unreachable at all.
*/
describe("a claim that outlived its lease cannot finish", () => {
  const finalizeWith = (h: Harness, claimToken: string, source = "stale") =>
    h.deps.operations.finalize({
      uid: UID,
      requestId: REQUEST_ID,
      claimToken,
      consumeQuota: (tx) =>
        h.deps.quota.consumeInTransaction(tx, {
          uid: UID,
          action: "plan_generation",
          requestId: REQUEST_ID,
        }),
      writeResult: (tx, planId) => {
        tx.create(h.db.collection("users").doc(UID).collection("workout_plans").doc(planId), {
          content: {},
          source,
        });
      },
    });

  it("refuses the claimant whose reservation was reclaimed under it", async () => {
    const h = harness();
    const stale = await claimAndAbandon(h, REQUEST_ID, "plan-stale");
    const staleToken = (stale as { claimToken: string }).claimToken;
    expect(quotaCount(h)).toBe(1);

    // The lease runs out, and an unrelated request reclaims the unit in passing.
    h.advance(CLAIM_LEASE_MS + 1000);
    await call(h, { requestId: OTHER_REQUEST_ID });
    expect(heldUnits(h).map((entry) => entry.requestId)).toEqual([]);
    expect(quotaCount(h)).toBe(1);

    // The abandoned invocation wakes up holding a token that still matches.
    const outcome = await finalizeWith(h, staleToken);

    expect(outcome).toEqual({ kind: "lost" });
    // Its plan was never written, so nothing exists that nobody paid for.
    expect(plans(h)).toHaveLength(1);
    expect(plans(h)[0][1].source).toBe("ai");
    expect(operation(h)?.status).toBe("in_progress");
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
  });

  it("refuses it even when nothing else has touched the allowance", async () => {
    const h = harness();
    const stale = await claimAndAbandon(h, REQUEST_ID, "plan-stale");
    const staleToken = (stale as { claimToken: string }).claimToken;

    h.advance(CLAIM_LEASE_MS + 1000);
    const outcome = await finalizeWith(h, staleToken);

    // The hold is still on the document here, so the old code would have
    // committed and charged correctly. It is refused all the same: a claim
    // nobody can vouch for is not a claim.
    expect(outcome).toEqual({ kind: "lost" });
    expect(plans(h)).toHaveLength(0);
    expect(operation(h)?.status).toBe("in_progress");
  });

  it("refuses a claimant whose request was taken over and is still running", async () => {
    const h = harness();
    const stale = await claimAndAbandon(h, REQUEST_ID, "plan-stale");
    const staleToken = (stale as { claimToken: string }).claimToken;

    h.advance(CLAIM_LEASE_MS + 1000);
    const winner = await claimAndAbandon(h, REQUEST_ID, "plan-stale");
    expect(winner.kind).toBe("claimed");

    const outcome = await finalizeWith(h, staleToken);

    expect(outcome).toEqual({ kind: "lost" });
    expect(plans(h)).toHaveLength(0);
    // And the successor still owns the request and its one unit.
    expect(operation(h)?.claimToken).toBe((winner as { claimToken: string }).claimToken);
    expect(heldUnits(h).map((entry) => entry.requestId)).toEqual([REQUEST_ID]);
    expect(quotaCount(h)).toBe(1);
  });

  it("still lets a live claim finish in the ordinary way", async () => {
    const h = harness();
    const result = await call(h);

    // The check must cost an ordinary generation nothing.
    expect(result.replay).toBe(false);
    expect(plans(h)).toHaveLength(1);
    expect(operation(h)?.status).toBe("completed");
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
    expect(heldUnits(h)).toHaveLength(0);
  });

  it("still replays a completed request, whose lease is deliberately gone", async () => {
    const h = harness();
    const done = await call(h);
    expect(operation(h)?.leaseExpiresAt).toBeNull();

    h.advance(CLAIM_LEASE_MS * 10);
    const replay = await call(h);

    expect(replay.replay).toBe(true);
    expect(replay.planId).toBe(done.planId);
    expect(h.providerCalls).toBe(1);
  });

  /*
    The same thing through the production handler: a provider call that takes
    longer than the lease. Nothing is written, the unit goes back, and the
    browser keeps the request id because the outcome is uncertain — so the
    retry is the same logical request and produces exactly one plan.
  */
  it("discards work from an invocation that ran past its own lease", async () => {
    const h = harness();
    const generate = h.deps.provider.generatePlanWithUsage;
    h.deps.provider = {
      ...h.deps.provider,
      generatePlanWithUsage: async (...args: Parameters<typeof generate>) => {
        h.advance(CLAIM_LEASE_MS + 1000);
        return generate(...args);
      },
    };

    await expect(call(h)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });

    expect(plans(h)).toHaveLength(0);
    expect(quotaCount(h)).toBe(0);
    expect(await effectiveUsage(h)).toBe(0);
    expect(operation(h)?.status).toBe("failed");
  });

  it("lets the retry of that request generate exactly one plan", async () => {
    const h = harness();
    const generate = h.deps.provider.generatePlanWithUsage;
    let slow = true;
    h.deps.provider = {
      ...h.deps.provider,
      generatePlanWithUsage: async (...args: Parameters<typeof generate>) => {
        if (slow) {
          slow = false;
          h.advance(CLAIM_LEASE_MS + 1000);
        }
        return generate(...args);
      },
    };

    await expect(call(h)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    const retry = await call(h);

    expect(retry.ok).toBe(true);
    expect(plans(h)).toHaveLength(1);
    expect(quotaCount(h)).toBe(1);
    expect(await effectiveUsage(h)).toBe(1);
    expect(heldUnits(h)).toHaveLength(0);
  });
});

/*
  The lease closes the hole on its own, but the margin still matters: an
  invocation that reached its lease before the platform stopped it would throw
  away work it had already paid the provider for. The budget has to stay
  comfortably inside the lease, and that is a relationship between two files
  with nothing but this test to hold it.
*/
describe("the lease outlasts the execution budget it covers", () => {
  it("gives an invocation less time to run than its claim is honoured for", () => {
    // Read from the package root, the way the client's own timeout guard does.
    const index = readFileSync("src/index.ts", "utf-8");
    const budget = Number(
      /timeoutSeconds:\s*(\d+)/.exec(index.slice(index.indexOf("generateWorkoutPlan")))?.[1]
    );

    expect(budget).toBe(180);
    expect(CLAIM_LEASE_MS).toBeGreaterThan(budget * 1000);
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
