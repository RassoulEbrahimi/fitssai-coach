import { describe, it, expect, vi } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
  NUTRITION_STATE_REQUEST_LEDGER_SIZE,
  buildRepeatedPlanContent,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  type NutritionPlan,
  type NutritionUserState,
} from "../../../shared/nutrition";
import { fakeFirestore } from "../testing/fakeFirestore";
import {
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY,
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2,
  FIXTURE_REJECT_PLAN_VALIDATION_POLICY,
  fixturePlanValidationPolicyRegistry,
} from "../testing/fixturePlanValidationPolicies";
import { FIXTURE_MANUAL_POLICY, fixtureTargetPolicyRegistry } from "../testing/fixtureTargetPolicies";
import {
  ADULT_PROFILE,
  PLANS,
  SOURCE_END,
  SOURCE_START,
  STATE_PATH,
  UID,
  planPath,
  requestId,
  storedPlan,
  storedState,
  storedTarget,
  targetPath,
} from "../testing/nutritionPlanFixtures";
import { NutritionPlanError, toNutritionHttpsError } from "./errors";
import { productionPlanValidationPolicyRegistry } from "./planValidation/registry";
import type { PlanValidationPolicy } from "./planValidation/types";
import { handleNutritionRepeatPlan } from "./repeatPlan";
import { handleNutritionSetTarget } from "./setTarget";

/*
  NUT-09: `nutritionRepeatPlan`, end to end against the in-memory Firestore.

  Production has no plan-validation policy, so the deployed handler can only
  answer PLAN_VALIDATION_POLICY_NOT_CONFIGURED once its preconditions hold;
  that path is pinned first. Everything else runs on TEST FIXTURE policies
  from src/testing/, which accept or reject by fiat and mean nothing.

  Meal ids: a repeated plan keeps its source's meal ids. A meal id is unique
  within its plan, and every reference to a meal carries its plan id, so the
  pair (planId, mealId) stays unambiguous — and the repeated content is a pure
  function of the source, identical on every retry and replay.
*/

/** 09:15 UTC on 28 Sep: Berlin's 28 Sep. The source week runs 23–29 Sep. */
const NOW = new Date("2026-09-28T09:15:00.000Z");
const NEXT_START = "2026-09-30";
const NEXT_END = "2026-10-06";

const SLOTS = `users/${UID}/nutrition_v2_slots/`;
const ENTRIES = `users/${UID}/nutrition_v2_entries/`;

const setup = (
  options: {
    profile?: Record<string, unknown> | null;
    state?: Record<string, unknown> | null;
    plans?: Record<string, Record<string, unknown>>;
    targets?: string[];
    policies?: readonly PlanValidationPolicy[] | "production";
    now?: Date;
    failWrites?: (path: string) => boolean;
  } = {}
) => {
  const firestore = fakeFirestore({ failWrites: options.failWrites });
  if (options.profile !== null) firestore.docs.set(`users/${UID}`, { ...(options.profile ?? ADULT_PROFILE) });
  if (options.state !== null) firestore.docs.set(STATE_PATH, options.state ?? storedState());
  for (const [id, plan] of Object.entries(options.plans ?? { "plan-1": storedPlan("plan-1") })) {
    firestore.docs.set(planPath(id), plan);
  }
  for (const id of options.targets ?? ["target-1"]) firestore.docs.set(targetPath(id), storedTarget(id));

  let minted = 0;
  const deps = {
    firestore,
    policies:
      options.policies === "production"
        ? productionPlanValidationPolicyRegistry
        : fixturePlanValidationPolicyRegistry(options.policies ?? [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY]),
    now: () => options.now ?? NOW,
    newPlanId: () => `plan-new-${(minted += 1)}`,
  };
  const call = (data: unknown, uid: string | null = UID) =>
    handleNutritionRepeatPlan(uid === null ? { data } : { auth: { uid }, data }, deps);
  const nutritionDocs = () => firestore.under(`users/${UID}/nutrition_v2_`).map(([path, data]) => [path, { ...data }] as const);
  const state = () => firestore.docs.get(STATE_PATH) as NutritionUserState | undefined;
  const plan = (id: string) => firestore.docs.get(planPath(id)) as (NutritionPlan & Record<string, unknown>) | undefined;
  return { firestore, deps, call, nutritionDocs, state, plan };
};

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
};

const code = async (promise: Promise<unknown>) => ((await refusal(promise)) as NutritionPlanError).code;

const repeatOnce = { requestId: requestId(1) };

/* ------------------------------------------------------------------ *
 * Production: an empty validation registry
 * ------------------------------------------------------------------ */

describe("the production registry", () => {
  it("answers PLAN_VALIDATION_POLICY_NOT_CONFIGURED once every precondition holds, and writes nothing", async () => {
    const { call, nutritionDocs } = setup({ policies: "production" });
    const before = nutritionDocs();

    expect(await code(call(repeatOnce))).toBe("PLAN_VALIDATION_POLICY_NOT_CONFIGURED");
    expect(nutritionDocs()).toEqual(before);
  });

  it("maps the refusal to a neutral failed-precondition with the code as its only message", async () => {
    const { call } = setup({ policies: "production" });
    const error = toNutritionHttpsError(await refusal(call(repeatOnce)));

    expect(error.code).toBe("failed-precondition");
    expect(error.message).toBe("PLAN_VALIDATION_POLICY_NOT_CONFIGURED");
    expect(error.details).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Auth, request and eligibility
 * ------------------------------------------------------------------ */

describe("who may repeat a plan", () => {
  it("refuses a signed-out call before reading anything", async () => {
    const { call, nutritionDocs } = setup();
    const before = nutritionDocs();
    const error = await refusal(call(repeatOnce, null));

    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe("unauthenticated");
    expect(nutritionDocs()).toEqual(before);
  });

  it.each([
    ["a minor", { ...ADULT_PROFILE, age: 17 }, "minor"],
    ["a missing age", { ...ADULT_PROFILE, age: undefined }, "missingAge"],
    ["no profile document", null, "missingAge"],
  ])("refuses %s as NOT_ELIGIBLE with the reason code only", async (_name, profile, reason) => {
    const { call, nutritionDocs } = setup({ profile: profile as Record<string, unknown> | null });
    const before = nutritionDocs();
    const error = (await refusal(call(repeatOnce))) as NutritionPlanError;

    expect(error.code).toBe("NOT_ELIGIBLE");
    expect(error.details).toEqual({ reason });
    expect(JSON.stringify(toNutritionHttpsError(error).toJSON())).not.toMatch(/17|68\.25|female/);
    expect(nutritionDocs()).toEqual(before);
  });

  it.each([
    ["no data", undefined],
    ["an upper-case request id", { requestId: "3F2B8C1E-9A4D-4E6F-8B21-7C5D0E9A1B34" }],
    ["a non-UUID request id", { requestId: "abc" }],
    ["a uid", { ...repeatOnce, uid: "bob" }],
    ["a plan id", { ...repeatOnce, planId: "plan-mine" }],
    ["a target id", { ...repeatOnce, targetVersionId: "target-9" }],
    ["a start date", { ...repeatOnce, startDate: "2026-10-01" }],
    ["meal content", { ...repeatOnce, days: [] }],
    ["slot heads", { ...repeatOnce, slotHeads: [] }],
    ["an override", { ...repeatOnce, override: { source: "aiSuggestion" } }],
  ])("refuses a request with %s as INVALID_REQUEST", async (_name, data) => {
    const { call, nutritionDocs } = setup();
    const before = nutritionDocs();
    expect(await code(call(data))).toBe("INVALID_REQUEST");
    expect(nutritionDocs()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Preconditions
 * ------------------------------------------------------------------ */

describe("preconditions", () => {
  it.each([
    ["there is no state", { state: null }, "NO_CURRENT_TARGET"],
    ["there is no target", { state: storedState({ currentTargetVersionId: null }) }, "NO_CURRENT_TARGET"],
    ["there is no active plan", { state: storedState({ activePlanId: null }) }, "NO_ACTIVE_PLAN"],
    [
      "the active plan is superseded",
      {
        plans: {
          "plan-1": storedPlan("plan-1", {
            lifecycle: { status: "superseded", effectiveUntil: SOURCE_END, supersededByPlanId: "plan-x" },
          }),
        },
      },
      "PLAN_NOT_ACTIVE",
    ],
    [
      "the active plan was made for an earlier target",
      { state: storedState({ currentTargetVersionId: "target-2" }), targets: ["target-1", "target-2"] },
      "TARGET_CHANGED",
    ],
    ["the active plan is missing", { plans: {} }, "INTERNAL"],
    ["the active plan is malformed", { plans: { "plan-1": { ...storedPlan("plan-1"), validation: null } } }, "INTERNAL"],
    ["the active plan is stored under another id", { plans: { "plan-1": storedPlan("plan-7") } }, "INTERNAL"],
    ["the current target is missing", { targets: [] }, "INTERNAL"],
    ["the state is malformed", { state: { schemaVersion: 2 } }, "INTERNAL"],
  ])("refuses when %s as %s, and writes nothing", async (_name, seed, expected) => {
    const { call, nutritionDocs } = setup(seed as Parameters<typeof setup>[0]);
    const before = nutritionDocs();
    expect(await code(call(repeatOnce))).toBe(expected);
    expect(nutritionDocs()).toEqual(before);
  });

  it("does not leak paths, Firebase errors or profile values", async () => {
    const { call } = setup({ plans: { "plan-1": storedPlan("plan-7") } });
    const error = toNutritionHttpsError(await refusal(call(repeatOnce)));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("INTERNAL");
    expect(JSON.stringify(error.toJSON())).not.toMatch(/users\/|nutrition_v2|plan-7|alice/);
  });
});

describe("the repeated week's dates", () => {
  it.each([
    ["the day after the source ends is still ahead", "2026-09-28T09:15:00.000Z"],
    ["the new week starts today", "2026-09-30T08:00:00.000Z"],
    // 22:30 UTC on 29 Sep is already 30 Sep in Berlin (CEST).
    ["the new week starts today in Berlin, not yet in UTC", "2026-09-29T22:30:00.000Z"],
  ])("repeats when %s", async (_name, at) => {
    const { call, plan } = setup({ now: new Date(at) });
    await call(repeatOnce);
    expect(plan("plan-new-1")).toMatchObject({ startDate: NEXT_START, endDate: NEXT_END });
  });

  it.each([
    ["the new week would have started yesterday", "2026-10-01T09:00:00.000Z"],
    // 22:30 UTC on 30 Sep is 1 Oct in Berlin: the UTC date would wrongly allow it.
    ["it is already the next day in Berlin", "2026-09-30T22:30:00.000Z"],
    ["the source week is long over", "2026-11-15T12:00:00.000Z"],
  ])("refuses as PLAN_NOT_REPEATABLE when %s, never shifting, skipping or stretching", async (_name, at) => {
    const { call, nutritionDocs } = setup({ now: new Date(at) });
    const before = nutritionDocs();
    expect(await code(call(repeatOnce))).toBe("PLAN_NOT_REPEATABLE");
    expect(nutritionDocs()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * The copy
 * ------------------------------------------------------------------ */

describe("the repeated plan", () => {
  it("is the source's BASE content one week later, under a new server-minted id", async () => {
    const { call, plan } = setup();
    const result = await call(repeatOnce);

    expect(result).toEqual({ ok: true, planId: "plan-new-1", replay: false });
    const source = nutritionPlanSchema.parse(storedPlan("plan-1"));
    const repeated = plan("plan-new-1") as Record<string, unknown>;
    expect(nutritionPlanSchema.safeParse(repeated).success).toBe(true);
    expect(repeated).toMatchObject({
      planId: "plan-new-1",
      source: "repeated",
      repeatedFromPlanId: "plan-1",
      generationRequestId: null,
      targetVersionId: "target-1",
      startDate: NEXT_START,
      endDate: NEXT_END,
      slotOrder: source.slotOrder,
    });
    expect((repeated.days as { date: string }[]).map((day) => day.date)).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    // Day i of the source is day i of the repeat: same meals, ids, names and values.
    expect((repeated.days as NutritionPlan["days"]).map((day) => day.meals)).toEqual(source.days.map((day) => day.meals));
    expect({ startDate: repeated.startDate, endDate: repeated.endDate, slotOrder: repeated.slotOrder, days: repeated.days }).toEqual(
      buildRepeatedPlanContent(source)
    );
  });

  it("copies no slot head, override, recorded entry or generation state", async () => {
    const { call, firestore, plan, state } = setup({
      state: storedState({ activeGenerationRequestId: "gen-3" }),
    });
    const head = {
      schemaVersion: 2,
      planId: "plan-1",
      date: "2026-09-24",
      slotId: "lunch",
      selection: {
        kind: "override",
        override: { source: "aiSuggestion", meal: { name: "Override meal", values: { kcal: 999, proteinG: 1, carbsG: 1, fatG: 1 } } },
      },
    };
    const entry = { schemaVersion: 2, entryId: "slot:2026-09-24:lunch", date: "2026-09-24", name: "Recorded meal" };
    firestore.docs.set(`${SLOTS}plan-1__2026-09-24__lunch`, head);
    firestore.docs.set(`${ENTRIES}slot:2026-09-24:lunch`, entry);

    await call(repeatOnce);

    expect(JSON.stringify(plan("plan-new-1"))).not.toMatch(/Override meal|Recorded meal|999|gen-3/);
    expect(firestore.under(SLOTS)).toEqual([[`${SLOTS}plan-1__2026-09-24__lunch`, head]]);
    expect(firestore.under(ENTRIES)).toEqual([[`${ENTRIES}slot:2026-09-24:lunch`, entry]]);
    // The generation pointer is carried over, not consumed.
    expect(state()?.activeGenerationRequestId).toBe("gen-3");
  });

  it("supersedes the source through its own end, and changes nothing else about it", async () => {
    const { call, plan, state } = setup();
    const before = { ...storedPlan("plan-1") };
    await call(repeatOnce);

    const source = plan("plan-1") as Record<string, unknown>;
    expect(source.lifecycle).toEqual({ status: "superseded", effectiveUntil: SOURCE_END, supersededByPlanId: "plan-new-1" });
    expect({ ...source, lifecycle: null }).toEqual({ ...before, lifecycle: null });
    expect(plan("plan-new-1")?.lifecycle).toEqual({ status: "active", effectiveUntil: null, supersededByPlanId: null });
    expect(state()).toEqual({
      schemaVersion: 2,
      revision: 5,
      activePlanId: "plan-new-1",
      currentTargetVersionId: "target-1",
      activeGenerationRequestId: null,
      recentRequests: [{ requestId: requestId(1), operation: "repeatPlan", resultPlanId: "plan-new-1" }],
    });
  });

  it("repeats a repeat: the chain moves one week at a time", async () => {
    const { call, plan, state } = setup();
    await call(repeatOnce);
    await call({ requestId: requestId(2) });

    expect(plan("plan-new-2")).toMatchObject({
      repeatedFromPlanId: "plan-new-1",
      startDate: "2026-10-07",
      endDate: "2026-10-13",
    });
    expect(plan("plan-new-1")?.lifecycle).toEqual({ status: "superseded", effectiveUntil: NEXT_END, supersededByPlanId: "plan-new-2" });
    expect(state()).toMatchObject({ activePlanId: "plan-new-2", revision: 6 });
  });

  it("server-generates the plan id, distinct from the request id", async () => {
    const { deps, firestore } = setup();
    const result = await handleNutritionRepeatPlan(
      { auth: { uid: UID }, data: repeatOnce },
      { firestore, policies: deps.policies, now: () => NOW }
    );
    expect(result.planId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(result.planId).not.toBe(repeatOnce.requestId);
  });
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

describe("validation", () => {
  it("reuses the source's acceptance when the same policy version is in force, without running it", async () => {
    const validate = vi.fn(() => ({ outcome: "rejected" }));
    const { call, plan } = setup({ policies: [{ id: "test-fixture-accept", version: 1, validate }] });
    await call(repeatOnce);

    expect(validate).not.toHaveBeenCalled();
    expect(plan("plan-new-1")?.validation).toEqual({ policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" });
  });

  it("runs a changed policy version and records its own acceptance", async () => {
    const { call, plan } = setup({ policies: [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2] });
    await call(repeatOnce);
    expect(plan("plan-new-1")?.validation).toEqual({ policy: { id: "test-fixture-accept", version: 2 }, outcome: "accepted" });
  });

  it("refuses as PLAN_VALIDATION_FAILED when the policy in force rejects the repeat, and writes nothing", async () => {
    const { call, nutritionDocs } = setup({ policies: [FIXTURE_REJECT_PLAN_VALIDATION_POLICY] });
    const before = nutritionDocs();
    expect(await code(call(repeatOnce))).toBe("PLAN_VALIDATION_FAILED");
    expect(nutritionDocs()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Idempotency
 * ------------------------------------------------------------------ */

describe("request idempotency", () => {
  it("answers a repeated request id with the same plan, and writes nothing", async () => {
    const { call, nutritionDocs, state, firestore } = setup();
    await call(repeatOnce);
    const before = nutritionDocs();

    expect(await call(repeatOnce)).toEqual({ ok: true, planId: "plan-new-1", replay: true });
    expect(nutritionDocs()).toEqual(before);
    expect(state()?.revision).toBe(5);
    expect(state()?.recentRequests).toHaveLength(1);
    expect(firestore.under(PLANS)).toHaveLength(2);
  });

  it("replays even after the policies, the date or the target changed", async () => {
    const { call, deps, firestore } = setup();
    await call(repeatOnce);
    firestore.docs.set(STATE_PATH, { ...firestore.docs.get(STATE_PATH), currentTargetVersionId: "target-2" });

    const replay = await handleNutritionRepeatPlan(
      { auth: { uid: UID }, data: repeatOnce },
      { ...deps, policies: productionPlanValidationPolicyRegistry, now: () => new Date("2027-01-01T12:00:00Z") }
    );
    expect(replay).toEqual({ ok: true, planId: "plan-new-1", replay: true });
  });

  it("converges concurrent duplicates on one plan and one revision", async () => {
    const { call, firestore, state } = setup();
    const results = await Promise.all([call(repeatOnce), call(repeatOnce), call(repeatOnce)]);

    expect(new Set(results.map((result) => result.planId))).toEqual(new Set(["plan-new-1"]));
    expect(results.filter((result) => !result.replay)).toHaveLength(1);
    expect(firestore.under(PLANS).map(([path]) => path).sort()).toEqual([planPath("plan-1"), planPath("plan-new-1")]);
    expect(state()?.revision).toBe(5);
    expect(state()?.recentRequests).toHaveLength(1);
  });

  it("lets exactly one of two concurrent distinct repeats win; the other is stale and writes nothing", async () => {
    const { call, firestore, state } = setup();
    const results = await Promise.allSettled([call(repeatOnce), call({ requestId: requestId(2) })]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(((results[1] as PromiseRejectedResult).reason as NutritionPlanError).code).toBe("STALE_ACTIVE_PLAN");
    expect(firestore.under(PLANS)).toHaveLength(2);
    expect(state()?.revision).toBe(5);
  });

  it.each([
    ["missing", undefined],
    ["malformed", { planId: "plan-new-1" }],
  ])("is INTERNAL when the ledger names a %s plan, and creates no replacement", async (_name, replacement) => {
    const { call, firestore, state } = setup();
    await call(repeatOnce);
    if (replacement === undefined) firestore.docs.delete(planPath("plan-new-1"));
    else firestore.docs.set(planPath("plan-new-1"), replacement);

    expect(await code(call(repeatOnce))).toBe("INTERNAL");
    expect(firestore.under(PLANS)).toHaveLength(replacement === undefined ? 1 : 2);
    expect(state()?.revision).toBe(5);
  });

  it("changes no revision when a request is refused", async () => {
    const { call, state } = setup({ policies: [FIXTURE_REJECT_PLAN_VALIDATION_POLICY] });
    await refusal(call(repeatOnce));
    expect(state()?.revision).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * The shared ledger
 * ------------------------------------------------------------------ */

describe("the state ledger holds setTarget and repeatPlan together", () => {
  const setTarget = (n: number) => ({ requestId: requestId(100 + n), operation: "setTarget", resultTargetVersionId: `t-${n}` });

  it(`evicts the oldest record of either operation beyond ${NUTRITION_STATE_REQUEST_LEDGER_SIZE}, and the revision keeps counting`, async () => {
    const earlier = Array.from({ length: NUTRITION_STATE_REQUEST_LEDGER_SIZE - 1 }, (_, index) => setTarget(index + 1));
    const { call, state } = setup({ state: storedState({ revision: 30, recentRequests: earlier }) });

    await call(repeatOnce);
    expect(state()?.recentRequests).toHaveLength(NUTRITION_STATE_REQUEST_LEDGER_SIZE);
    await call({ requestId: requestId(2) });

    const ledger = state()?.recentRequests ?? [];
    expect(ledger).toHaveLength(NUTRITION_STATE_REQUEST_LEDGER_SIZE);
    expect(ledger[0]).toEqual(setTarget(2));
    expect(ledger.slice(-2)).toEqual([
      { requestId: requestId(1), operation: "repeatPlan", resultPlanId: "plan-new-1" },
      { requestId: requestId(2), operation: "repeatPlan", resultPlanId: "plan-new-2" },
    ]);
    expect(state()?.revision).toBe(32);
    expect(state()!.revision).toBeGreaterThan(ledger.length);
    expect(nutritionUserStateSchema.safeParse(state()).success).toBe(true);
  });

  it("keeps setTarget semantics: a target change after a repeat stops the next repeat, and each id stays with its operation", async () => {
    const { call, firestore, state } = setup({ profile: { ...ADULT_PROFILE, manualTargetKcal: 1800 } });
    await call(repeatOnce);

    const targetDeps = { firestore, policies: fixtureTargetPolicyRegistry([FIXTURE_MANUAL_POLICY]), now: () => NOW, newTargetId: () => "target-2" };
    await handleNutritionSetTarget({ auth: { uid: UID }, data: { mode: "manual", requestId: requestId(3) } }, targetDeps);
    expect(state()).toMatchObject({ revision: 6, activePlanId: "plan-new-1", currentTargetVersionId: "target-2" });
    expect(state()?.recentRequests.map((request) => request.operation)).toEqual(["repeatPlan", "setTarget"]);

    // A week planned for target-1 is not reused under target-2.
    expect(await code(call({ requestId: requestId(4) }))).toBe("TARGET_CHANGED");
    // An id belongs to the operation that applied it.
    expect(await code(call({ requestId: requestId(3) }))).toBe("INVALID_REQUEST");
    const reused = await refusal(
      handleNutritionSetTarget({ auth: { uid: UID }, data: { mode: "manual", requestId: requestId(1) } }, targetDeps)
    );
    expect((reused as { code: string }).code).toBe("INVALID_REQUEST");
    // A setTarget replay is still a replay.
    expect(
      await handleNutritionSetTarget({ auth: { uid: UID }, data: { mode: "manual", requestId: requestId(3) } }, targetDeps)
    ).toEqual({ ok: true, targetVersionId: "target-2", replay: true });
    expect(state()?.revision).toBe(6);
  });
});

/* ------------------------------------------------------------------ *
 * Atomicity
 * ------------------------------------------------------------------ */

describe("atomicity", () => {
  it.each([STATE_PATH, planPath("plan-1"), planPath("plan-new-1")])(
    "leaves no partial plan, lifecycle or state when the write to %s fails",
    async (failing) => {
      const { call, nutritionDocs } = setup({ failWrites: (path) => path === failing });
      const before = nutritionDocs();
      expect(await code(call(repeatOnce))).toBe("INTERNAL");
      expect(nutritionDocs()).toEqual(before);
    }
  );
});

/* ------------------------------------------------------------------ *
 * Error mapping
 * ------------------------------------------------------------------ */

describe("toNutritionHttpsError for plan codes", () => {
  it.each([
    ["INVALID_REQUEST", "invalid-argument"],
    ["NOT_ELIGIBLE", "permission-denied"],
    ["NO_CURRENT_TARGET", "failed-precondition"],
    ["NO_ACTIVE_PLAN", "failed-precondition"],
    ["PLAN_NOT_ACTIVE", "failed-precondition"],
    ["TARGET_CHANGED", "failed-precondition"],
    ["PLAN_NOT_REPEATABLE", "failed-precondition"],
    ["PLAN_VALIDATION_POLICY_NOT_CONFIGURED", "failed-precondition"],
    ["PLAN_VALIDATION_FAILED", "failed-precondition"],
    ["STALE_ACTIVE_PLAN", "aborted"],
    ["STALE_TARGET", "aborted"],
    ["INTERNAL", "internal"],
  ] as const)("maps %s to %s with the code as message and no prose", (errorCode, httpsCode) => {
    const error = toNutritionHttpsError(new NutritionPlanError(errorCode, "users/alice/nutrition_v2_plans/plan-1 detail"));
    expect(error.code).toBe(httpsCode);
    expect(error.message).toBe(errorCode);
    expect(error.details).toBeUndefined();
  });
});

describe("source dates", () => {
  it("the fixture source week is the one these tests assume", () => {
    expect([SOURCE_START, SOURCE_END]).toEqual(["2026-09-23", "2026-09-29"]);
  });
});
