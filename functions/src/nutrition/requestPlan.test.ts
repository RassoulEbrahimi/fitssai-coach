import { describe, it, expect } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
  addNutritionDays,
  generationRequestSchema,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  type GenerationRequest,
  type NutritionPlan,
  type NutritionUserState,
} from "../../../shared/nutrition";
import { createFirestoreOperationStore } from "../idempotency";
import { NUTRITION_PLAN_OPERATIONS, OPERATION_COLLECTION, WORKOUT_PLAN_OPERATIONS } from "../operationRecords";
import { fakeFirestore, type FakeFirestore } from "../testing/fakeFirestore";
import {
  FIXTURE_INITIAL_SLOTS,
  FIXTURE_OPERATION_LEASE_MS,
  createFakeNutritionPlanProvider,
  fixtureGenerationProviderRegistry,
  type FakeNutritionPlanProvider,
  type FakeProviderScript,
} from "../testing/fakeNutritionPlanProvider";
import {
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY,
  FIXTURE_NAME_PLAN_VALIDATION_POLICY,
  FIXTURE_REJECT_PLAN_VALIDATION_POLICY,
  fixturePlanValidationPolicyRegistry,
} from "../testing/fixturePlanValidationPolicies";
import { FIXTURE_MANUAL_POLICY, fixtureTargetPolicyRegistry } from "../testing/fixtureTargetPolicies";
import {
  FIXTURE_VERTEX_CONFIGURATION,
  FIXTURE_VERTEX_DEPLOYMENT,
  createFakeGoogleGenAiClient,
  fixtureMealIds,
  fixtureVertexReply,
} from "../testing/fakeGoogleGenAiClient";
import {
  ADULT_PROFILE,
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
import { NUTRITION_AI_PRODUCTION_ENABLED } from "./aiGate";
import { NutritionGenerationError, toNutritionHttpsError } from "./errors";
import { productionInitialSlotConfiguration } from "./generationInput";
import type { NutritionGenerationProviderRegistry } from "./generationProvider";
import {
  createNutritionVertexProviderRegistry,
  productionNutritionGenerationProviderRegistry,
} from "./providers/productionRegistry";
import { productionPlanValidationPolicyRegistry } from "./planValidation/registry";
import type { PlanValidationPolicy } from "./planValidation/types";
import { handleNutritionRepeatPlan } from "./repeatPlan";
import { handleNutritionRequestPlan } from "./requestPlan";
import { handleNutritionSetTarget } from "./setTarget";

/*
  NUT-11: `nutritionRequestPlan`, end to end against the in-memory Firestore.

  Production has no generator, no plan-validation policy and no first-plan
  slot mapping, so the deployed handler answers
  GENERATION_PROVIDER_NOT_CONFIGURED and writes nothing; that is pinned
  first. Everything else runs on TEST FIXTURES from src/testing/: a scripted
  generator with no network, prompt or model, validation policies that accept
  or reject by fiat, and a fixed breakfast/lunch/dinner slot list.

  The clock is 09:15 UTC on Monday 28 Sep (Berlin 28 Sep). The seeded active
  plan, plan-1, runs 23–29 Sep.
*/

const NOW = new Date("2026-09-28T09:15:00.000Z");
const TODAY = "2026-09-28";
const TOMORROW = "2026-09-29";
const LEASE = FIXTURE_OPERATION_LEASE_MS;

const GENERATIONS = `users/${UID}/nutrition_v2_generations/`;
const SLOT_HEAD_PATH = `users/${UID}/nutrition_v2_slots/plan-1__2026-09-28__lunch`;
const ENTRY_PATH = `users/${UID}/nutrition_v2_entries/slot:2026-09-28:lunch`;
const generationPath = (id: string) => GENERATIONS + id;
const operationPath = (id: string) => `${OPERATION_COLLECTION}/${NUTRITION_PLAN_OPERATIONS.docId(UID, id)}`;

/** A profile with more in it than generation may read. */
const PROFILE = {
  ...ADULT_PROFILE,
  fullName: "Alice Beispiel",
  email: "alice@example.com",
  fitnessGoal: "loseWeight",
  activityLevel: "moderatelyActive",
  nutritionTargetMode: "manual",
  manualTargetKcal: 1777,
  dietaryPreference: "vegetarian",
  mealsPerDay: 3,
  excludedFoodCategories: ["shellfish-raw-marker"],
};

const RID = requestId(11);
const OTHER = requestId(12);

interface Options {
  profile?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
  plans?: Record<string, Record<string, unknown>>;
  targets?: string[];
  script?: FakeProviderScript;
  policies?: readonly PlanValidationPolicy[] | "production";
  initialSlots?: "production";
  failWrites?: (path: string) => boolean;
  extra?: Record<string, Record<string, unknown>>;
}

const setup = (options: Options = {}) => {
  const firestore = fakeFirestore({ failWrites: options.failWrites });
  if (options.profile !== null) firestore.docs.set(`users/${UID}`, { ...(options.profile ?? PROFILE) });
  if (options.state !== null) firestore.docs.set(STATE_PATH, options.state ?? storedState());
  for (const [id, plan] of Object.entries(options.plans ?? { "plan-1": storedPlan("plan-1") })) firestore.docs.set(planPath(id), plan);
  for (const id of options.targets ?? ["target-1"]) firestore.docs.set(targetPath(id), storedTarget(id));
  for (const [path, data] of Object.entries(options.extra ?? {})) firestore.docs.set(path, data);

  let at = NOW.getTime();
  let minted = 0;
  let tokens = 0;
  const clock = () => new Date(at);
  const policies =
    options.policies === "production"
      ? productionPlanValidationPolicyRegistry
      : fixturePlanValidationPolicyRegistry(options.policies ?? [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY]);
  const provider = createFakeNutritionPlanProvider(options.script ?? { generate: "valid" });

  /**
   * `via: "production"` swaps in the production generator registry only;
   * `production: true` swaps in every production registry — generator, policy
   * and first-plan slots — as a deployment that lost its configuration would.
   * `enabled` is the backend AI gate (NUT-12B): these lifecycle tests pass it
   * explicitly, on unless a test turns it off; `registry` replaces the
   * generator registry outright.
   */
  const call = (
    data: unknown,
    {
      uid = UID as string | null,
      via = provider as FakeNutritionPlanProvider | "production",
      production = false,
      enabled = true,
      registry = null as NutritionGenerationProviderRegistry | null,
    } = {}
  ) =>
    handleNutritionRequestPlan(uid === null ? { data } : { auth: { uid }, data }, {
      firestore,
      generationEnabled: enabled,
      providers:
        registry ??
        (via === "production" || production ? productionNutritionGenerationProviderRegistry : fixtureGenerationProviderRegistry(via)),
      policies: production ? productionPlanValidationPolicyRegistry : policies,
      initialSlots: options.initialSlots === "production" || production ? productionInitialSlotConfiguration : FIXTURE_INITIAL_SLOTS,
      now: clock,
      newPlanId: () => `gen-plan-${(minted += 1)}`,
      newClaimToken: () => `claim-${(tokens += 1)}`,
    });

  const repeat = (id: string) =>
    handleNutritionRepeatPlan({ auth: { uid: UID }, data: { requestId: id } }, { firestore, policies, now: clock, newPlanId: () => "plan-repeat" });

  return {
    firestore,
    provider,
    call,
    repeat,
    advance: (ms: number) => {
      at += ms;
    },
    snapshot: () => JSON.stringify([...firestore.docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    state: () => firestore.docs.get(STATE_PATH) as NutritionUserState | undefined,
    plan: (id: string) => {
      const raw = firestore.docs.get(planPath(id));
      return raw ? nutritionPlanSchema.parse(raw) : undefined;
    },
    rawPlan: (id: string) => firestore.docs.get(planPath(id)),
    planIds: () => firestore.under(`users/${UID}/nutrition_v2_plans/`).map(([path]) => path.split("/").pop()),
    request: (id: string): GenerationRequest | undefined => {
      const raw = firestore.docs.get(generationPath(id));
      return raw ? generationRequestSchema.parse(raw) : undefined;
    },
    requests: () => firestore.under(GENERATIONS),
    operation: (id: string) => firestore.docs.get(operationPath(id)),
  };
};

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
};

const code = async (promise: Promise<unknown>) => ((await refusal(promise)) as NutritionGenerationError).code;

const INITIAL_STATE = storedState({ activePlanId: null });

const seconds = (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 });

/* ------------------------------------------------------------------ *
 * The deployed boundary
 * ------------------------------------------------------------------ */

describe("the deployed boundary: nothing is configured to generate", () => {
  it("answers GENERATION_PROVIDER_NOT_CONFIGURED and writes nothing — no request, pointer, plan, record or quota", async () => {
    const h = setup();
    const before = h.snapshot();
    const error = await refusal(h.call({ requestId: RID }, { via: "production" }));

    expect(error).toBeInstanceOf(NutritionGenerationError);
    expect((error as NutritionGenerationError).code).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
    expect(h.requests()).toEqual([]);
    expect(h.firestore.under(OPERATION_COLLECTION)).toEqual([]);
    expect(h.firestore.under("_ai_quota")).toEqual([]);
    expect(h.firestore.under("_ai_logs")).toEqual([]);
    expect(h.state()?.activeGenerationRequestId).toBeNull();
  });

  it("maps that refusal to a failed-precondition carrying only the code", async () => {
    const h = setup();
    const mapped = toNutritionHttpsError(await refusal(h.call({ requestId: RID }, { via: "production" })));
    expect(mapped).toBeInstanceOf(HttpsError);
    expect(mapped.code).toBe("failed-precondition");
    expect(mapped.message).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(mapped.details).toBeUndefined();
  });

  it("answers the same for a new first plan: nothing is configured to start one", async () => {
    const h = setup({ state: INITIAL_STATE, plans: {} });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }, { via: "production" }))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
  });

  it("with a generator but the production (empty) validation registry: PLAN_VALIDATION_POLICY_NOT_CONFIGURED, nothing written", async () => {
    const h = setup({ policies: "production" });
    const before = h.snapshot();
    expect(productionPlanValidationPolicyRegistry.current()).toBeNull();
    expect(await code(h.call({ requestId: RID }))).toBe("PLAN_VALIDATION_POLICY_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toEqual([]);
  });

  it("a first plan with the production (empty) slot configuration: GENERATION_SLOTS_NOT_CONFIGURED, nothing written", async () => {
    const h = setup({ state: INITIAL_STATE, plans: {}, initialSlots: "production" });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }))).toBe("GENERATION_SLOTS_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toEqual([]);
  });
});

describe("refusals before anything is written", () => {
  it("refuses a signed-out caller", async () => {
    const h = setup();
    const error = await refusal(h.call({ requestId: RID }, { uid: null }));
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe("unauthenticated");
    expect(h.provider.calls.generate).toEqual([]);
  });

  it.each([
    ["a minor", { ...PROFILE, age: 17 }, "minor"],
    ["a missing age", { ...PROFILE, age: undefined }, "missingAge"],
    ["an unusable age", { ...PROFILE, age: "34" }, "missingAge"],
    ["no profile at all", null, "missingAge"],
  ])("refuses %s as NOT_ELIGIBLE, reporting the reason and never the age", async (_label, profile, reason) => {
    const h = setup({ profile });
    const before = h.snapshot();
    const error = (await refusal(h.call({ requestId: RID }))) as NutritionGenerationError;
    expect(error.code).toBe("NOT_ELIGIBLE");
    expect(error.details).toEqual({ reason });
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["an empty object", {}],
    ["an upper-case id", { requestId: "3f1a6f28-9c4e-4a1b-8f2d-77c0b5e1a9d4".toUpperCase() }],
    ["not a UUID", { requestId: "plan-1" }],
    ...["uid", "kind", "basePlanId", "targetVersionId", "stateRevision", "profile", "age", "weight", "dietaryPreference", "mealsPerDay", "slotOrder", "excludedFoods", "planId", "content", "provider", "model", "prompt", "quota"].map(
      (field): [string, unknown] => [`an extra ${field}`, { requestId: RID, [field]: "x" }]
    ),
  ])("refuses %s as INVALID_REQUEST", async (_label, data) => {
    const h = setup();
    const before = h.snapshot();
    expect(await code(h.call(data))).toBe("INVALID_REQUEST");
    expect(h.snapshot()).toBe(before);
  });

  it.each([
    ["no Nutrition state", null],
    ["no current target", storedState({ currentTargetVersionId: null })],
  ])("refuses %s as NO_CURRENT_TARGET", async (_label, state) => {
    const h = setup({ state });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }))).toBe("NO_CURRENT_TARGET");
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toEqual([]);
  });

  it("refuses a request id another operation already applied", async () => {
    const h = setup({ state: storedState({ recentRequests: [{ requestId: RID, operation: "setTarget", resultTargetVersionId: "target-1" }] }) });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }))).toBe("INVALID_REQUEST");
    expect(h.snapshot()).toBe(before);
  });

  it("refuses a malformed state, a missing or malformed target, as INTERNAL — never as empty", async () => {
    expect(await code(setup({ state: { ...storedState(), revision: 0 } }).call({ requestId: RID }))).toBe("INTERNAL");
    expect(await code(setup({ targets: [] }).call({ requestId: RID }))).toBe("INTERNAL");
    const malformed = setup({ extra: { [targetPath("target-1")]: { ...storedTarget("target-1"), values: { kcal: -1 } } } });
    expect(await code(malformed.call({ requestId: RID }))).toBe("INTERNAL");
  });
});

/* ------------------------------------------------------------------ *
 * Claim
 * ------------------------------------------------------------------ */

describe("the claim", () => {
  it("creates exactly one running request, names it in the state and reserves one server-minted plan id — together", async () => {
    const h = setup({ script: { generate: "pending" } });
    const running = h.call({ requestId: RID });
    await h.provider.whenPending();

    expect(h.requests()).toHaveLength(1);
    expect(h.request(RID)).toEqual({
      schemaVersion: 2,
      requestId: RID,
      idempotencyKey: `nutritionPlan:${RID}`,
      kind: "regenerate",
      basePlanId: "plan-1",
      targetVersionId: "target-1",
      payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      status: "running",
      resultPlanId: null,
      errorCode: null,
      createdAt: seconds(NOW),
      finishedAt: null,
      acknowledgedAt: null,
    });
    expect(h.state()).toMatchObject({ revision: 5, activeGenerationRequestId: RID, activePlanId: "plan-1" });
    expect(h.state()?.recentRequests).toEqual([]);
    expect(h.operation(RID)).toMatchObject({
      uid: UID,
      namespace: "nutritionPlan",
      status: "in_progress",
      claimToken: "claim-1",
      planId: "gen-plan-1",
      attempts: 1,
    });
    expect(h.operation(RID)).not.toHaveProperty("quotaCharged");
    expect(h.firestore.under("_ai_quota")).toEqual([]);

    h.provider.release();
    await running;
  });

  it("answers the same id while it runs with the running request, and never calls the generator twice", async () => {
    const h = setup({ script: { generate: "pending" } });
    const first = h.call({ requestId: RID });
    await h.provider.whenPending();
    const before = h.snapshot();

    expect(await h.call({ requestId: RID })).toEqual({
      ok: true,
      requestId: RID,
      status: "running",
      resultPlanId: null,
      errorCode: null,
      replay: false,
    });
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toHaveLength(1);

    h.provider.release();
    await first;
  });

  it("answers a different id while one is live with THAT request, and creates nothing for the new id", async () => {
    const h = setup({ script: { generate: "pending" } });
    const first = h.call({ requestId: RID });
    await h.provider.whenPending();
    const before = h.snapshot();

    expect(await h.call({ requestId: OTHER })).toMatchObject({ requestId: RID, status: "running" });
    expect(h.snapshot()).toBe(before);
    expect(h.request(OTHER)).toBeUndefined();
    expect(h.operation(OTHER)).toBeUndefined();
    expect(h.provider.calls.generate).toHaveLength(1);

    h.provider.release();
    await first;
  });

  it("keeps one UUID used by Workout and by Nutrition generation in two independent records", async () => {
    const h = setup();
    const workout = createFirestoreOperationStore(h.firestore, () => NOW);
    const claimed = await workout.claim({ uid: UID, requestId: RID, mintPlanId: () => "workout-plan-1", reserveQuota: async () => true });
    expect(claimed.kind).toBe("claimed");

    const answer = await h.call({ requestId: RID });
    expect(answer).toMatchObject({ requestId: RID, status: "succeeded" });

    const workoutRecord = h.firestore.docs.get(`${OPERATION_COLLECTION}/${WORKOUT_PLAN_OPERATIONS.docId(UID, RID)}`);
    expect(workoutRecord).toMatchObject({ status: "in_progress", planId: "workout-plan-1", quotaCharged: true });
    expect(workoutRecord).not.toHaveProperty("namespace");
    expect(h.operation(RID)).toMatchObject({ namespace: "nutritionPlan", status: "completed", planId: "gen-plan-1" });
    expect(h.firestore.under(OPERATION_COLLECTION)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Success
 * ------------------------------------------------------------------ */

describe("an initial plan", () => {
  it("starts today (Berlin), is activated with server-owned metadata, and ends the request succeeded", async () => {
    const h = setup({ state: INITIAL_STATE, plans: {} });
    expect(await h.call({ requestId: RID })).toEqual({
      ok: true,
      requestId: RID,
      status: "succeeded",
      resultPlanId: "gen-plan-1",
      errorCode: null,
      replay: false,
    });

    const plan = h.plan("gen-plan-1") as NutritionPlan;
    expect(plan.startDate).toBe(TODAY);
    expect(plan.days.map((day) => day.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(plan).toMatchObject({
      planId: "gen-plan-1",
      targetVersionId: "target-1",
      source: "generated",
      repeatedFromPlanId: null,
      generationRequestId: RID,
      validation: { policy: { id: FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY.id, version: 1 }, outcome: "accepted" },
      createdAt: seconds(NOW),
      activatedAt: seconds(NOW),
      lifecycle: { status: "active", effectiveUntil: null, supersededByPlanId: null },
    });
    expect(plan.slotOrder).toEqual(["breakfast", "lunch", "dinner"]);

    expect(h.request(RID)).toMatchObject({
      kind: "initial",
      basePlanId: null,
      status: "succeeded",
      resultPlanId: "gen-plan-1",
      errorCode: null,
      finishedAt: seconds(NOW),
    });
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "gen-plan-1", activeGenerationRequestId: null });
    expect(h.state()?.recentRequests).toEqual([]);
    expect(h.operation(RID)).toMatchObject({ status: "completed", planId: "gen-plan-1", leaseExpiresAt: null });
    expect(nutritionUserStateSchema.safeParse(h.state()).success).toBe(true);
  });
});

describe("a regeneration", () => {
  it("captures the old plan, starts tomorrow, and leaves the old plan owning today", async () => {
    const h = setup({ extra: { [SLOT_HEAD_PATH]: { marker: "head" }, [ENTRY_PATH]: { marker: "entry" } } });
    const before = h.plan("plan-1") as NutritionPlan;

    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });

    const successor = h.plan("gen-plan-1") as NutritionPlan;
    expect(successor.startDate).toBe(TOMORROW);
    expect(successor.lifecycle.status).toBe("active");
    expect(h.request(RID)).toMatchObject({ kind: "regenerate", basePlanId: "plan-1", status: "succeeded" });

    // The predecessor's one lifecycle transition, and nothing else.
    const predecessor = h.plan("plan-1") as NutritionPlan;
    expect(predecessor.lifecycle).toEqual({ status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "gen-plan-1" });
    expect({ ...predecessor, lifecycle: before.lifecycle }).toEqual(before);

    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "gen-plan-1", activeGenerationRequestId: null });
    // Slot heads and recorded entries are not generation's to touch.
    expect(h.firestore.docs.get(SLOT_HEAD_PATH)).toEqual({ marker: "head" });
    expect(h.firestore.docs.get(ENTRY_PATH)).toEqual({ marker: "entry" });
  });

  it("works from a plan activated today: that plan keeps today", async () => {
    const h = setup({ plans: { "plan-1": storedPlan("plan-1", { startDate: TODAY }) } });
    await h.call({ requestId: RID });
    expect(h.plan("plan-1")?.lifecycle).toEqual({ status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "gen-plan-1" });
    expect(h.plan("gen-plan-1")?.startDate).toBe(TOMORROW);
  });

  it("refuses a base that starts tomorrow or later (a future successor): PLAN_NOT_REGENERABLE, nothing written", async () => {
    for (const startDate of [TOMORROW, "2026-09-30"]) {
      const h = setup({
        plans: {
          "plan-0": storedPlan("plan-0", { lifecycle: { status: "superseded", effectiveUntil: "2026-09-28", supersededByPlanId: "plan-1" } }),
          "plan-1": storedPlan("plan-1", { startDate }),
        },
      });
      const before = h.snapshot();
      expect(await code(h.call({ requestId: RID }))).toBe("PLAN_NOT_REGENERABLE");
      expect(h.snapshot()).toBe(before);
      expect(h.provider.calls.generate).toEqual([]);
    }
  });

  it("refuses a state that points to a plan that is not active", async () => {
    const h = setup({
      plans: { "plan-1": storedPlan("plan-1", { lifecycle: { status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "plan-9" } }) },
    });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }))).toBe("PLAN_NOT_ACTIVE");
    expect(h.snapshot()).toBe(before);
  });

  it("replays a succeeded request without generating again or moving the revision", async () => {
    const h = setup();
    const first = await h.call({ requestId: RID });
    const before = h.snapshot();

    expect(await h.call({ requestId: RID })).toEqual({ ...first, replay: true });
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.planIds().sort()).toEqual(["gen-plan-1", "plan-1"]);
  });
});

/* ------------------------------------------------------------------ *
 * Staleness
 * ------------------------------------------------------------------ */

describe("stale finalisation", () => {
  it("REPEAT WINS: a repeat activated while the generator ran; the generated week is discarded, Plan B stays", async () => {
    const h = setup({
      script: { generate: "pending" },
      extra: { [SLOT_HEAD_PATH]: { marker: "head" }, [ENTRY_PATH]: { marker: "entry" } },
    });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    expect(h.request(RID)?.basePlanId).toBe("plan-1");

    // Plan B: next week, repeated from Plan A, while the generator is out.
    await h.repeat(OTHER);
    const planA = h.rawPlan("plan-1");
    const planB = h.rawPlan("plan-repeat");
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "plan-repeat", activeGenerationRequestId: RID });

    h.provider.release();
    expect(await generating).toEqual({
      ok: true,
      requestId: RID,
      status: "discarded_stale",
      resultPlanId: null,
      errorCode: "STALE_ACTIVE_PLAN",
      replay: false,
    });

    expect(h.request(RID)).toMatchObject({ status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN", resultPlanId: null, finishedAt: seconds(NOW) });
    // No generated plan; A and B exactly as the repeat left them.
    expect(h.planIds().sort()).toEqual(["plan-1", "plan-repeat"]);
    expect(h.rawPlan("plan-1")).toEqual(planA);
    expect(h.rawPlan("plan-repeat")).toEqual(planB);
    expect(h.plan("plan-1")?.lifecycle).toEqual({ status: "superseded", effectiveUntil: "2026-09-29", supersededByPlanId: "plan-repeat" });
    expect(h.state()).toMatchObject({ revision: 7, activePlanId: "plan-repeat", activeGenerationRequestId: null });
    expect(h.operation(RID)).toMatchObject({ status: "discarded", claimToken: null, leaseExpiresAt: null });
    expect(h.firestore.docs.get(SLOT_HEAD_PATH)).toEqual({ marker: "head" });
    expect(h.firestore.docs.get(ENTRY_PATH)).toEqual({ marker: "entry" });
  });

  it("TARGET WINS: the target changed while the generator ran; T2 stays current and the plan is untouched", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    const planBefore = h.rawPlan("plan-1");

    await handleNutritionSetTarget(
      { auth: { uid: UID }, data: { mode: "manual", requestId: OTHER } },
      { firestore: h.firestore, policies: fixtureTargetPolicyRegistry([FIXTURE_MANUAL_POLICY]), now: () => NOW, newTargetId: () => "target-2" }
    );
    expect(h.state()).toMatchObject({ revision: 6, currentTargetVersionId: "target-2", activeGenerationRequestId: RID });

    h.provider.release();
    expect(await generating).toMatchObject({ status: "discarded_stale", errorCode: "STALE_TARGET", resultPlanId: null });

    expect(h.request(RID)?.targetVersionId).toBe("target-1");
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.rawPlan("plan-1")).toEqual(planBefore);
    expect(h.state()).toMatchObject({ revision: 7, activePlanId: "plan-1", currentTargetVersionId: "target-2", activeGenerationRequestId: null });
  });

  it("replays a discarded request as it ended", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    await h.repeat(OTHER);
    h.provider.release();
    await generating;
    const before = h.snapshot();

    expect(await h.call({ requestId: RID })).toMatchObject({ status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN", replay: true });
    expect(h.snapshot()).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * Failure and repair
 * ------------------------------------------------------------------ */

describe("failure keeps the current plan", () => {
  const expectFailedCleanly = (h: ReturnType<typeof setup>, errorCode: string) => {
    expect(h.request(RID)).toMatchObject({ status: "failed", errorCode, resultPlanId: null, finishedAt: seconds(NOW) });
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.plan("plan-1")?.lifecycle.status).toBe("active");
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "plan-1", activeGenerationRequestId: null });
    expect(h.operation(RID)).toMatchObject({ status: "failed", claimToken: null, leaseExpiresAt: null });
  };

  it("a generator that throws: failed PROVIDER_FAILED, and nothing of its error is kept", async () => {
    const h = setup({ script: { generate: "throws" } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED" });
    expectFailedCleanly(h, "PROVIDER_FAILED");
    expect(h.provider.calls.repair).toEqual([]);
    expect(h.snapshot()).not.toMatch(/secret|sk-live|fixture provider failure/);
  });

  it("malformed, then a valid repair: succeeded, with exactly one repair", async () => {
    const h = setup({ script: { generate: "malformed", repair: "valid" } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.provider.calls.repair).toHaveLength(1);

    const [repair] = h.provider.calls.repair;
    expect(repair.input).toEqual(h.provider.calls.generate[0]);
    expect(repair.failure.kind).toBe("invalidContent");
    expect(Object.keys(repair).sort()).toEqual(["failure", "input"]);
    // Normalised: no profile, account, path, exception or secret.
    expect(JSON.stringify(repair)).not.toMatch(/alice|Beispiel|example\.com|users\/|nutrition_v2_|_ai_|Error|stack|vegetarian-raw|shellfish/);
  });

  it("the provider cannot choose the plan id: a candidate carrying one is not plan content", async () => {
    const h = setup({ script: { generate: "malformed", repair: null } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "CANDIDATE_INVALID" });
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.snapshot()).not.toMatch(/chosen-by-the-provider/);
  });

  it("malformed twice: failed CANDIDATE_INVALID after one repair — never a loop", async () => {
    const h = setup({ script: { generate: "malformed", repair: "malformed" } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "CANDIDATE_INVALID" });
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.provider.calls.repair).toHaveLength(1);
    expectFailedCleanly(h, "CANDIDATE_INVALID");
  });

  it("dates that were not asked for are repaired like any structural failure", async () => {
    const h = setup({ script: { generate: "mismatched", repair: "valid" } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded" });
    expect(h.provider.calls.repair[0].failure).toEqual({ kind: "inputMismatch", issues: [{ path: "startDate", message: `must be ${TOMORROW}` }] });
  });

  it("policy-rejected, then accepted: succeeded; the repair is told only that the policy refused", async () => {
    const h = setup({ script: { generate: "rejected", repair: "valid" }, policies: [FIXTURE_NAME_PLAN_VALIDATION_POLICY] });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded" });
    expect(h.provider.calls.repair[0].failure).toEqual({ kind: "rejectedByPolicy" });
    expect(h.plan("gen-plan-1")?.validation).toEqual({ policy: { id: "test-fixture-name", version: 1 }, outcome: "accepted" });
  });

  it("validation rejects twice: failed PLAN_VALIDATION_FAILED", async () => {
    const h = setup({ script: { generate: "valid", repair: "valid" }, policies: [FIXTURE_REJECT_PLAN_VALIDATION_POLICY] });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "PLAN_VALIDATION_FAILED" });
    expect(h.provider.calls.repair).toHaveLength(1);
    expectFailedCleanly(h, "PLAN_VALIDATION_FAILED");
  });

  it("a repair that throws: failed PROVIDER_FAILED", async () => {
    const h = setup({ script: { generate: "malformed", repair: "throws" } });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED" });
    expectFailedCleanly(h, "PROVIDER_FAILED");
  });

  it("a finalisation transaction that fails leaves no partial plan, request or state, and the request then fails safely", async () => {
    const h = setup({ failWrites: (path) => path.startsWith(`users/${UID}/nutrition_v2_plans/gen-`) });
    const planBefore = h.rawPlan("plan-1");
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "INTERNAL" });
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.rawPlan("plan-1")).toEqual(planBefore);
    expectFailedCleanly(h, "INTERNAL");
  });

  it("replays a failed request as failed; the same id never restarts it", async () => {
    const h = setup({ script: { generate: "throws" } });
    await h.call({ requestId: RID });
    const before = h.snapshot();
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED", replay: true });
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toHaveLength(1);
  });

  it("a new request after a failure generates normally", async () => {
    const h = setup({ script: { generate: "throws" } });
    await h.call({ requestId: RID });
    const retry = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: OTHER }, { via: retry })).toMatchObject({ requestId: OTHER, status: "succeeded" });
  });
});

/* ------------------------------------------------------------------ *
 * Leases, takeover and recovery
 * ------------------------------------------------------------------ */

describe("an invocation that stops", () => {
  it("is taken over by the same id once its lease runs out: same request, same plan id, new owner; the old one cannot finish", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    const created = h.request(RID);

    h.advance(LEASE + 1);
    const successor = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: RID }, { via: successor })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });

    expect(successor.calls.generate).toEqual(h.provider.calls.generate);
    expect(h.requests()).toHaveLength(1);
    const { status, resultPlanId, finishedAt, ...immutable } = h.request(RID) as GenerationRequest;
    expect(immutable).toEqual((({ status: _s, resultPlanId: _r, finishedAt: _f, ...rest }) => rest)(created as GenerationRequest));
    expect({ status, resultPlanId }).toEqual({ status: "succeeded", resultPlanId: "gen-plan-1" });
    expect(finishedAt).not.toBeNull();
    expect(h.operation(RID)).toMatchObject({ status: "completed", planId: "gen-plan-1", attempts: 2 });

    // The first invocation wakes up: it may not commit a second plan.
    h.provider.release();
    expect(await stalled).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });
    expect(h.planIds().sort()).toEqual(["gen-plan-1", "plan-1"]);
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "gen-plan-1", activeGenerationRequestId: null });
  });

  it("an old claim cannot fail the newer owner", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);

    const successor = createFakeNutritionPlanProvider({ generate: "pending" });
    const running = h.call({ requestId: RID }, { via: successor });
    await successor.whenPending();

    h.provider.release("throws");
    expect(await stalled).toMatchObject({ status: "running" });
    expect(h.request(RID)?.status).toBe("running");
    expect(h.operation(RID)).toMatchObject({ status: "in_progress", claimToken: "claim-2" });

    successor.release();
    expect(await running).toMatchObject({ status: "succeeded" });
  });

  it("never takes a live request from its invocation", async () => {
    const h = setup({ script: { generate: "pending" } });
    const first = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE - 1);
    const before = h.snapshot();

    expect(await h.call({ requestId: OTHER })).toMatchObject({ requestId: RID, status: "running" });
    expect(h.snapshot()).toBe(before);
    h.provider.release();
    await first;
  });

  it("a newer request ends an abandoned one (failed GENERATION_ABANDONED) in its own claim; the old attempt cannot finalize", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);

    const next = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: OTHER }, { via: next })).toMatchObject({ requestId: OTHER, status: "succeeded", resultPlanId: "gen-plan-2" });
    expect(h.request(RID)).toMatchObject({ status: "failed", errorCode: "GENERATION_ABANDONED" });
    expect(h.operation(RID)).toMatchObject({ status: "failed", claimToken: null });
    // 4 → 5 (first claim) → 6 (the recovery and the new claim, together) → 7 (activation).
    expect(h.state()).toMatchObject({ revision: 7, activePlanId: "gen-plan-2", activeGenerationRequestId: null });

    h.provider.release();
    expect(await stalled).toMatchObject({ requestId: RID, status: "failed", errorCode: "GENERATION_ABANDONED" });
    expect(h.planIds().sort()).toEqual(["gen-plan-2", "plan-1"]);
  });

  it("a finish past its own lease writes nothing; the same id then takes over and completes", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);

    h.provider.release();
    expect(await stalled).toMatchObject({ status: "running" });
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.state()?.activeGenerationRequestId).toBe(RID);

    const retry = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: RID }, { via: retry })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });
  });

  it("a takeover whose rebuilt input differs (the next day) ends the request INPUT_CHANGED without calling the generator", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    const fingerprint = h.request(RID)?.payloadFingerprint;
    h.advance(24 * 60 * 60 * 1000);

    const retry = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: RID }, { via: retry })).toMatchObject({ status: "discarded_stale", errorCode: "INPUT_CHANGED", replay: false });
    expect(retry.calls.generate).toEqual([]);
    // The persisted fingerprint is never rewritten to match the new input.
    expect(h.request(RID)?.payloadFingerprint).toBe(fingerprint);
    expect(h.request(RID)?.createdAt).toEqual(seconds(NOW));
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "plan-1", activeGenerationRequestId: null });

    h.provider.release();
    expect(await stalled).toMatchObject({ status: "discarded_stale", errorCode: "INPUT_CHANGED" });
    expect(h.planIds()).toEqual(["plan-1"]);
  });

  it("a takeover after the base plan changed ends the request STALE_ACTIVE_PLAN", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    await h.repeat(OTHER);
    h.advance(LEASE + 1);

    const retry = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: RID }, { via: retry })).toMatchObject({ status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN" });
    expect(retry.calls.generate).toEqual([]);
    h.provider.release();
    await stalled;
    expect(h.planIds().sort()).toEqual(["plan-1", "plan-repeat"]);
  });
});

describe("the active pointer's integrity", () => {
  const finished = (id: string, status: "succeeded" | "failed"): Record<string, unknown> => ({
    schemaVersion: 2,
    requestId: id,
    idempotencyKey: `nutritionPlan:${id}`,
    kind: "regenerate",
    basePlanId: "plan-0",
    targetVersionId: "target-1",
    payloadFingerprint: "b".repeat(64),
    status,
    resultPlanId: status === "succeeded" ? "plan-1" : null,
    errorCode: status === "failed" ? "PROVIDER_FAILED" : null,
    createdAt: seconds(NOW),
    finishedAt: seconds(NOW),
    acknowledgedAt: null,
  });

  it("a pointer to a finished request never blocks: it is replaced by the new claim, one revision", async () => {
    const h = setup({
      state: storedState({ activeGenerationRequestId: OTHER }),
      extra: { [generationPath(OTHER)]: finished(OTHER, "failed") },
    });
    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded" });
    expect(h.request(OTHER)?.status).toBe("failed");
    expect(h.state()).toMatchObject({ revision: 6, activeGenerationRequestId: null });
  });

  it.each([
    ["missing", undefined],
    ["malformed", { ...finished(OTHER, "failed"), prompt: "never stored" }],
    ["running with no operation record", { ...finished(OTHER, "failed"), status: "running", errorCode: null, finishedAt: null }],
  ])("a pointer to a %s request is an integrity failure, never empty: INTERNAL, nothing written", async (_label, doc) => {
    const h = setup({
      state: storedState({ activeGenerationRequestId: OTHER }),
      extra: doc ? { [generationPath(OTHER)]: doc } : {},
    });
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }))).toBe("INTERNAL");
    expect(h.snapshot()).toBe(before);
    expect(h.provider.calls.generate).toEqual([]);
  });

  it("a stored request that does not parse is not replayed", async () => {
    const h = setup({ extra: { [generationPath(RID)]: { ...finished(RID, "succeeded"), status: "cancelled" } } });
    expect(await code(h.call({ requestId: RID }))).toBe("INTERNAL");
  });
});

/* ------------------------------------------------------------------ *
 * The revision rule
 * ------------------------------------------------------------------ */

describe("the state revision", () => {
  it("moves by one per state-changing transaction: claim, activation, failure, discard — never for a replay or a takeover", async () => {
    // Success: claim +1, activation +1.
    const success = setup();
    await success.call({ requestId: RID });
    expect(success.state()?.revision).toBe(6);
    await success.call({ requestId: RID });
    expect(success.state()?.revision).toBe(6);

    // Failure: claim +1, failure +1.
    const failure = setup({ script: { generate: "throws" } });
    await failure.call({ requestId: RID });
    expect(failure.state()?.revision).toBe(6);

    // In progress: nothing.
    const busy = setup({ script: { generate: "pending" } });
    const running = busy.call({ requestId: RID });
    await busy.provider.whenPending();
    expect(busy.state()?.revision).toBe(5);
    await busy.call({ requestId: OTHER });
    expect(busy.state()?.revision).toBe(5);

    // Takeover: nothing (the pointer already names the request); then activation +1.
    busy.advance(LEASE + 1);
    await busy.call({ requestId: RID }, { via: createFakeNutritionPlanProvider({ generate: "valid" }) });
    expect(busy.state()?.revision).toBe(6);
    busy.provider.release();
    await running;
    expect(busy.state()?.revision).toBe(6);
  });

  it("is never the ledger's length, and generation adds nothing to the ledger", async () => {
    const h = setup();
    await h.call({ requestId: RID });
    expect(h.state()?.recentRequests).toEqual([]);
    expect(h.state()?.revision).toBeGreaterThan(h.state()?.recentRequests.length ?? 0);
  });
});

describe("what is persisted", () => {
  it("keeps the request to the contract: no profile value, no input, no prompt, no provider answer", async () => {
    const h = setup({ script: { generate: "pending" } });
    const running = h.call({ requestId: RID });
    await h.provider.whenPending();

    // The fingerprint is a hash; any two digits may occur in it.
    const { payloadFingerprint: _hash, ...request } = h.firestore.docs.get(generationPath(RID)) ?? {};
    const stored = JSON.stringify([request, h.operation(RID)]);
    expect(stored).not.toMatch(/\b34\b/);
    for (const leak of ["68.25", "172.5", "female", "Alice", "example.com", "vegetarian", "loseWeight", "moderatelyActive", "1777", "shellfish", "breakfast", "1234.5", TOMORROW]) {
      expect(stored, leak).not.toContain(leak);
    }
    expect(Object.keys(h.firestore.docs.get(generationPath(RID)) ?? {}).sort()).toEqual(
      [
        "acknowledgedAt",
        "basePlanId",
        "createdAt",
        "errorCode",
        "finishedAt",
        "idempotencyKey",
        "kind",
        "payloadFingerprint",
        "requestId",
        "resultPlanId",
        "schemaVersion",
        "status",
        "targetVersionId",
      ].sort()
    );
    h.provider.release();
    await running;
  });

  it("gives the generator the minimized input and nothing else", async () => {
    const h = setup();
    await h.call({ requestId: RID });
    const [input] = h.provider.calls.generate;
    expect(input).toEqual({
      startDate: TOMORROW,
      dayCount: 7,
      target: { kcal: 1234.5, proteinG: 1, carbsG: 2, fatG: 3 },
      slotOrder: ["breakfast", "lunch", "dinner"],
      dietaryPreference: "vegetarian",
    });
    expect(JSON.stringify(input)).not.toMatch(/alice|Alice|example|\b34\b|68\.25|172\.5|female|loseWeight|moderately|1777|shellfish|users\/|nutrition_v2_|plan-1|target-1/);
  });

  it("uses no quota and writes no AI log", async () => {
    const h = setup();
    await h.call({ requestId: RID });
    expect(h.firestore.under("_ai_quota")).toEqual([]);
    expect(h.firestore.under("_ai_logs")).toEqual([]);
    expect(h.firestore.under(`users/${UID}/ai_logs`)).toEqual([]);
  });

  it("the seeded base plan is a valid plan the whole time", () => {
    expect(nutritionPlanSchema.safeParse(storedPlan("plan-1")).success).toBe(true);
    expect(SOURCE_START).toBe("2026-09-23");
  });
});

/* ------------------------------------------------------------------ *
 * Eligibility is judged inside the transactions (review fix)
 * ------------------------------------------------------------------ */

/**
 * Firestore's optimistic transaction, emulated over the serialised fake (as in
 * updateSlot.test.ts). Each attempt records every document it reads and
 * buffers its writes. `interleave` runs once, after the first attempt has read
 * everything and before it would commit — a concurrent write that lands first.
 * If any document the attempt READ has changed by then, the attempt is
 * discarded and the body runs again against the new state. A document read
 * outside the transaction is not in the read set, so a change to it would not
 * stop the commit.
 */
const withOptimisticRetry = (firestore: ReturnType<typeof setup>["firestore"], interleave: () => void) => {
  type Ref = { path?: string; where?: unknown };
  type Tx = {
    get: (ref: Ref) => Promise<unknown>;
    create: (ref: Ref, value: Record<string, unknown>) => void;
    set: (ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
    update: (ref: Ref, value: Record<string, unknown>) => void;
  };
  const fake = firestore as unknown as FakeFirestore;
  const serialised = fake.runTransaction.bind(fake) as unknown as <T>(body: (tx: Tx) => Promise<T>) => Promise<T>;
  const readSets: string[][] = [];
  let interleaved = false;
  const current = (path: string) => JSON.stringify(firestore.docs.get(path) ?? null);

  (fake as unknown as { runTransaction: unknown }).runTransaction = <T>(body: (tx: Tx) => Promise<T>) =>
    serialised(async (tx: Tx) => {
      for (;;) {
        const seen = new Map<string, string>();
        const writes: Array<() => void> = [];
        const result = await body({
          get: async (ref) => {
            if (typeof ref.where !== "function" && ref.path) seen.set(ref.path, current(ref.path));
            return tx.get(ref);
          },
          create: (ref, value) => writes.push(() => tx.create(ref, value)),
          set: (ref, value, options) => writes.push(() => tx.set(ref, value, options)),
          update: (ref, value) => writes.push(() => tx.update(ref, value)),
        });
        readSets.push([...seen.keys()]);
        if (!interleaved) {
          interleaved = true;
          interleave();
        }
        if ([...seen].some(([path, value]) => current(path) !== value)) continue; // contended: retry
        for (const write of writes) write();
        return result;
      }
    });
  return { readSets };
};

const PROFILE_PATH = `users/${UID}`;
const INELIGIBLE: Array<[string, Record<string, unknown>, "minor" | "missingAge"]> = [
  ["turns 17", { ...PROFILE, age: 17 }, "minor"],
  ["loses its age", { ...PROFILE, age: undefined }, "missingAge"],
  ["stores an unusable age", { ...PROFILE, age: "thirty" }, "missingAge"],
];

describe("eligibility is judged inside the claim transaction", () => {
  it.each(INELIGIBLE)(
    "a profile that %s while the claim is in flight wins: NOT_ELIGIBLE, nothing written, no provider call",
    async (_label, profile, reason) => {
      const h = setup();
      const before = h.snapshot();
      const { readSets } = withOptimisticRetry(h.firestore, () => h.firestore.docs.set(PROFILE_PATH, profile));

      const error = (await refusal(h.call({ requestId: RID }))) as NutritionGenerationError;
      expect([error.code, error.details]).toEqual(["NOT_ELIGIBLE", { reason }]);
      // The first attempt read the adult profile inside the claim, passed, and
      // was retried because that profile changed; the retry refused.
      expect(readSets).toHaveLength(1);
      expect(readSets[0]).toContain(PROFILE_PATH);
      expect(h.provider.calls.generate).toEqual([]);
      expect(h.requests()).toEqual([]);
      expect(h.operation(RID)).toBeUndefined();
      expect(h.state()).toMatchObject({ revision: 4, activeGenerationRequestId: null });
      // Everything but the profile is exactly as it was.
      const withoutProfile = (text: string) => JSON.parse(text).filter(([path]: [string]) => path !== PROFILE_PATH);
      expect(withoutProfile(h.snapshot())).toEqual(withoutProfile(before));
    }
  );

  it("an uncontended claim reads the profile in the same transaction as the request, its record and the state", async () => {
    const h = setup({ script: { generate: "pending" } });
    const { readSets } = withOptimisticRetry(h.firestore, () => undefined);
    const running = h.call({ requestId: RID });
    await h.provider.whenPending();
    expect(readSets[0].slice(0, 4)).toEqual([PROFILE_PATH, generationPath(RID), operationPath(RID), STATE_PATH]);
    h.provider.release();
    await running;
  });

  it.each(INELIGIBLE)("a takeover of a request whose profile %s ends it ELIGIBILITY_CHANGED without calling the provider", async (_label, profile) => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    const planBefore = h.rawPlan("plan-1");
    h.advance(LEASE + 1);
    h.firestore.docs.set(PROFILE_PATH, profile);

    const retry = createFakeNutritionPlanProvider({ generate: "valid" });
    expect(await h.call({ requestId: RID }, { via: retry })).toEqual({
      ok: true,
      requestId: RID,
      status: "discarded_stale",
      resultPlanId: null,
      errorCode: "ELIGIBILITY_CHANGED",
      replay: false,
    });
    expect(retry.calls.generate).toEqual([]);
    expect(h.planIds()).toEqual(["plan-1"]);
    expect(h.rawPlan("plan-1")).toEqual(planBefore);
    expect(h.operation(RID)).toMatchObject({ status: "discarded", claimToken: null, leaseExpiresAt: null });
    expect(h.state()).toMatchObject({ revision: 6, activePlanId: "plan-1", activeGenerationRequestId: null });

    // The stalled invocation wakes up: it may not commit anything.
    h.provider.release();
    expect(await stalled).toMatchObject({ status: "discarded_stale", errorCode: "ELIGIBILITY_CHANGED" });
    expect(h.planIds()).toEqual(["plan-1"]);
  });
});

describe("eligibility is judged inside the finalisation transaction", () => {
  it.each(INELIGIBLE)(
    "a profile that %s while the provider runs: discarded_stale ELIGIBILITY_CHANGED, nothing extended",
    async (_label, profile) => {
      const h = setup({
        script: { generate: "pending" },
        extra: { [SLOT_HEAD_PATH]: { marker: "head" }, [ENTRY_PATH]: { marker: "entry" } },
      });
      const generating = h.call({ requestId: RID });
      await h.provider.whenPending();
      expect(h.state()).toMatchObject({ revision: 5, activeGenerationRequestId: RID });
      const planBefore = h.rawPlan("plan-1");
      const targetBefore = h.firestore.docs.get(targetPath("target-1"));

      h.firestore.docs.set(PROFILE_PATH, profile);
      h.provider.release();

      expect(await generating).toEqual({
        ok: true,
        requestId: RID,
        status: "discarded_stale",
        resultPlanId: null,
        errorCode: "ELIGIBILITY_CHANGED",
        replay: false,
      });
      expect(h.request(RID)).toMatchObject({ status: "discarded_stale", errorCode: "ELIGIBILITY_CHANGED", finishedAt: seconds(NOW) });
      expect(h.planIds()).toEqual(["plan-1"]);
      expect(h.rawPlan("plan-1")).toEqual(planBefore);
      expect(h.firestore.docs.get(targetPath("target-1"))).toEqual(targetBefore);
      expect(h.firestore.docs.get(SLOT_HEAD_PATH)).toEqual({ marker: "head" });
      expect(h.firestore.docs.get(ENTRY_PATH)).toEqual({ marker: "entry" });
      expect(h.operation(RID)).toMatchObject({ status: "discarded", claimToken: null, leaseExpiresAt: null });
      // One terminal state write: the pointer cleared, +1.
      expect(h.state()).toMatchObject({ revision: 6, activePlanId: "plan-1", currentTargetVersionId: "target-1", activeGenerationRequestId: null });
      // No age or profile value is recorded anywhere.
      expect(JSON.stringify(h.firestore.docs.get(generationPath(RID)))).not.toMatch(/minor|missingAge|"17"|:17\b|thirty/);
    }
  );

  it("the finalisation reads the profile inside its own transaction", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    // Wrap now: the next transaction is the finalisation. The profile turns 17 just before it commits.
    const { readSets } = withOptimisticRetry(h.firestore, () => h.firestore.docs.set(PROFILE_PATH, { ...PROFILE, age: 17 }));
    h.provider.release();

    expect(await generating).toMatchObject({ status: "discarded_stale", errorCode: "ELIGIBILITY_CHANGED" });
    expect(readSets[0]).toContain(PROFILE_PATH);
    expect(readSets).toHaveLength(2);
    expect(h.planIds()).toEqual(["plan-1"]);
  });
});

/* ------------------------------------------------------------------ *
 * A stored request is answered whatever is configured now (review fix)
 * ------------------------------------------------------------------ */

describe("replay does not depend on the configuration", () => {
  it("SUCCEEDED: the same request replays its plan with every production registry unconfigured, writing nothing", async () => {
    const h = setup();
    const first = await h.call({ requestId: RID });
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { production: true })).toEqual({ ...first, replay: true, resultPlanId: "gen-plan-1" });
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
  });

  it("FAILED: the same request replays as failed and is not restarted", async () => {
    const h = setup({ script: { generate: "throws" } });
    await h.call({ requestId: RID });
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { production: true })).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED", replay: true });
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
  });

  it("DISCARDED_STALE: the same request replays as discarded", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    await h.repeat(OTHER);
    h.provider.release();
    await generating;
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { production: true })).toMatchObject({
      status: "discarded_stale",
      errorCode: "STALE_ACTIVE_PLAN",
      replay: true,
    });
    expect(h.snapshot()).toBe(before);
  });

  it("LIVE, SAME REQUEST: answered as running, with no second provider call and no write", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { production: true })).toEqual({
      ok: true,
      requestId: RID,
      status: "running",
      resultPlanId: null,
      errorCode: null,
      replay: false,
    });
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
    h.provider.release();
    await generating;
  });

  it("LIVE, OTHER REQUEST: the account's live request is answered and nothing is created for the new id", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    const before = h.snapshot();

    expect(await h.call({ requestId: OTHER }, { production: true })).toMatchObject({ requestId: RID, status: "running" });
    expect(h.request(OTHER)).toBeUndefined();
    expect(h.operation(OTHER)).toBeUndefined();
    expect(h.snapshot()).toBe(before);
    h.provider.release();
    await generating;
  });

  it("NEW REQUEST: with nothing live, production answers GENERATION_PROVIDER_NOT_CONFIGURED and writes nothing", async () => {
    const h = setup();
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }, { production: true }))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
  });

  it("TAKEOVER: an expired request is not continued without a generator — refused, nothing written, still running", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);
    const before = h.snapshot();

    expect(await code(h.call({ requestId: RID }, { production: true }))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(h.snapshot()).toBe(before);
    expect(h.request(RID)?.status).toBe("running");
    h.provider.release();
    await stalled;
  });

  it("a stored outcome is answered after the account stops being eligible: existing data stays, nothing is extended", async () => {
    const h = setup();
    await h.call({ requestId: RID });
    h.firestore.docs.set(PROFILE_PATH, { ...PROFILE, age: 17 });
    const before = h.snapshot();

    expect(await h.call({ requestId: RID })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1", replay: true });
    expect(await code(h.call({ requestId: OTHER }))).toBe("NOT_ELIGIBLE");
    expect(h.snapshot()).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * The backend AI gate (NUT-12B)
 * ------------------------------------------------------------------ */

/** A generator registry that counts how often it is asked, around a working fixture generator. */
const spyRegistry = (provider: FakeNutritionPlanProvider) => {
  const inner = fixtureGenerationProviderRegistry(provider);
  const spy: { asked: number; registry: NutritionGenerationProviderRegistry } = {
    asked: 0,
    registry: { current: () => ((spy.asked += 1), inner.current()) },
  };
  return spy;
};

describe("the backend AI gate", () => {
  it("is off in production, and the deployed wiring passes exactly that", () => {
    expect(NUTRITION_AI_PRODUCTION_ENABLED).toBe(false);
  });

  it("PRODUCTION: a new request with the production gate and registries answers NUTRITION_AI_DISABLED and writes nothing", async () => {
    const h = setup();
    const before = h.snapshot();
    const revision = h.state()?.revision;

    expect(await code(h.call({ requestId: RID }, { enabled: NUTRITION_AI_PRODUCTION_ENABLED, production: true }))).toBe("NUTRITION_AI_DISABLED");
    expect(h.snapshot()).toBe(before);
    expect(h.requests()).toEqual([]);
    expect(h.firestore.under(OPERATION_COLLECTION)).toEqual([]);
    expect(h.firestore.under("_ai_quota")).toEqual([]);
    expect(h.firestore.under("_ai_logs")).toEqual([]);
    expect(h.firestore.under(`users/${UID}/ai_logs`)).toEqual([]);
    expect(h.state()?.revision).toBe(revision);
    expect(h.state()?.activeGenerationRequestId).toBeNull();
    expect(h.planIds()).toEqual(["plan-1"]);
  });

  it("maps NUTRITION_AI_DISABLED to a failed-precondition carrying only the code", async () => {
    const h = setup();
    const mapped = toNutritionHttpsError(await refusal(h.call({ requestId: RID }, { enabled: false })));
    expect(mapped).toBeInstanceOf(HttpsError);
    expect(mapped.code).toBe("failed-precondition");
    expect(mapped.message).toBe("NUTRITION_AI_DISABLED");
    expect(mapped.details).toBeUndefined();
  });

  it("NEW REQUEST: off beats a fully working generator — the registry is never asked and the generator never called", async () => {
    const h = setup();
    const spy = spyRegistry(h.provider);
    const before = h.snapshot();

    expect(await code(h.call({ requestId: RID }, { enabled: false, registry: spy.registry }))).toBe("NUTRITION_AI_DISABLED");
    expect(spy.asked).toBe(0);
    expect(h.provider.calls.generate).toEqual([]);
    expect(h.snapshot()).toBe(before);
  });

  it("NEW FIRST PLAN: the same refusal, before eligibility and before any configuration is judged", async () => {
    for (const options of [{ state: INITIAL_STATE, plans: {} }, { profile: { ...PROFILE, age: 17 } }, { policies: "production" as const }]) {
      const h = setup(options);
      const before = h.snapshot();
      expect(await code(h.call({ requestId: RID }, { enabled: false }))).toBe("NUTRITION_AI_DISABLED");
      expect(h.snapshot()).toBe(before);
      expect(h.provider.calls.generate).toEqual([]);
    }
  });

  it("is judged by value only: nothing but an explicit true lets work through", async () => {
    const h = setup();
    const before = h.snapshot();
    for (const enabled of [false, "true", 1, 0, null] as unknown[]) {
      expect(await code(h.call({ requestId: RID }, { enabled: enabled as boolean }))).toBe("NUTRITION_AI_DISABLED");
    }
    expect(h.snapshot()).toBe(before);
  });

  it.each<[string, FakeProviderScript, Record<string, unknown>]>([
    ["SUCCEEDED", { generate: "valid" }, { status: "succeeded", resultPlanId: "gen-plan-1", replay: true }],
    ["FAILED", { generate: "throws" }, { status: "failed", errorCode: "PROVIDER_FAILED", replay: true }],
  ])("EXISTING %s request: replays with the gate off, without asking the registry, writing nothing", async (_label, script, expected) => {
    const h = setup({ script });
    await h.call({ requestId: RID });
    const spy = spyRegistry(h.provider);
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { enabled: false, registry: spy.registry })).toMatchObject(expected);
    expect(spy.asked).toBe(0);
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
  });

  it("EXISTING DISCARDED request: replays as discarded with the gate off", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    await h.repeat(OTHER);
    h.provider.release();
    await generating;
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { enabled: false })).toMatchObject({ status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN", replay: true });
    expect(h.snapshot()).toBe(before);
  });

  it("EXISTING LIVE request, same id: answered as running with the gate off — no second call, no write", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    const spy = spyRegistry(h.provider);
    const before = h.snapshot();

    expect(await h.call({ requestId: RID }, { enabled: false, registry: spy.registry })).toEqual({
      ok: true,
      requestId: RID,
      status: "running",
      resultPlanId: null,
      errorCode: null,
      replay: false,
    });
    expect(spy.asked).toBe(0);
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
    h.provider.release();
    await generating;
    expect(h.request(RID)?.status).toBe("succeeded");
  });

  it("ANOTHER request while one is live: the live one is answered with the gate off, and nothing is created", async () => {
    const h = setup({ script: { generate: "pending" } });
    const generating = h.call({ requestId: RID });
    await h.provider.whenPending();
    const before = h.snapshot();

    expect(await h.call({ requestId: OTHER }, { enabled: false })).toMatchObject({ requestId: RID, status: "running", replay: false });
    expect(h.request(OTHER)).toBeUndefined();
    expect(h.operation(OTHER)).toBeUndefined();
    expect(h.snapshot()).toBe(before);
    h.provider.release();
    await generating;
  });

  it("EXPIRED request, same id: no takeover with the gate off — refused, the request, record and state untouched, the registry never asked", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);
    const spy = spyRegistry(h.provider);
    const before = h.snapshot();
    const record = structuredClone(h.operation(RID));

    expect(await code(h.call({ requestId: RID }, { enabled: false, registry: spy.registry }))).toBe("NUTRITION_AI_DISABLED");
    expect(spy.asked).toBe(0);
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.snapshot()).toBe(before);
    expect(h.request(RID)?.status).toBe("running");
    expect(h.operation(RID)).toEqual(record);
    expect(h.state()?.activeGenerationRequestId).toBe(RID);

    // The stalled invocation lost its lease and cannot finish it…
    h.provider.release();
    expect(await stalled).toMatchObject({ requestId: RID, status: "running" });
    expect(h.request(RID)?.status).toBe("running");
    // …and with the gate on, the same id takes it over and completes, as the lifecycle says.
    const recovered = fixtureGenerationProviderRegistry(createFakeNutritionPlanProvider({ generate: "valid" }));
    expect(await h.call({ requestId: RID }, { registry: recovered })).toMatchObject({ requestId: RID, status: "succeeded", resultPlanId: "gen-plan-1" });
  });

  it("EXPIRED request, another id: the abandoned request is not ended and nothing is claimed with the gate off", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);
    const before = h.snapshot();

    expect(await code(h.call({ requestId: OTHER }, { enabled: false }))).toBe("NUTRITION_AI_DISABLED");
    expect(h.snapshot()).toBe(before);
    expect(h.request(RID)?.status).toBe("running");
    expect(h.request(OTHER)).toBeUndefined();
    h.provider.release();
    await stalled;
  });

  it("EXPIRED and STALE: the takeover still ends it discarded_stale — convergence, with no generator and no new claim", async () => {
    const h = setup({ script: { generate: "pending" } });
    const stalled = h.call({ requestId: RID });
    await h.provider.whenPending();
    h.advance(LEASE + 1);
    h.firestore.docs.set(STATE_PATH, { ...(h.state() as NutritionUserState), currentTargetVersionId: "target-2" });
    const spy = spyRegistry(h.provider);

    expect(await h.call({ requestId: RID }, { enabled: false, registry: spy.registry })).toMatchObject({
      status: "discarded_stale",
      errorCode: "STALE_TARGET",
      replay: false,
    });
    expect(spy.asked).toBe(0);
    expect(h.provider.calls.generate).toHaveLength(1);
    expect(h.state()?.activeGenerationRequestId).toBeNull();
    h.provider.release();
    await stalled;
  });
});

describe("the production generator registry behind an open gate", () => {
  it("unconfigured: GENERATION_PROVIDER_NOT_CONFIGURED — a different answer from NUTRITION_AI_DISABLED — and nothing written", async () => {
    const h = setup();
    const before = h.snapshot();
    expect(await code(h.call({ requestId: RID }, { enabled: true, via: "production" }))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(await code(h.call({ requestId: RID }, { enabled: false, via: "production" }))).toBe("NUTRITION_AI_DISABLED");
    expect(h.snapshot()).toBe(before);
  });

  it.each<[string, unknown]>([
    ["no location", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, location: "" } }],
    ["no project", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, project: undefined } }],
    ["no timeout", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, timeoutMs: undefined } }],
    ["no lease", { provider: FIXTURE_VERTEX_CONFIGURATION }],
    // Settings the pinned model cannot accept are configuration errors, never a paid call that fails.
    ["thinking level MINIMAL", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, thinkingLevel: "MINIMAL" } }],
    ["maxOutputTokens 65,537", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, maxOutputTokens: 65_537 } }],
    ["maxOutputTokens 0", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, maxOutputTokens: 0 } }],
    ["temperature 0", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, temperature: 0 } }],
    ["temperature 2.5", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, temperature: 2.5 } }],
  ])("misconfigured (%s): refused explicitly as GENERATION_PROVIDER_NOT_CONFIGURED, no client built, nothing written", async (_label, deployment) => {
    const h = setup();
    let built = 0;
    const client = createFakeGoogleGenAiClient([{ reply: {} }]);
    const registry = createNutritionVertexProviderRegistry(deployment, {
      createClient: () => ((built += 1), client),
    });
    const before = h.snapshot();

    const error = (await refusal(h.call({ requestId: RID }, { enabled: true, registry }))) as NutritionGenerationError;
    expect(error.code).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    const mapped = toNutritionHttpsError(error);
    expect(mapped.message).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
    expect(mapped.details).toBeUndefined();
    for (const leak of ["MINIMAL", "65537", "2.5", "fixture-project", "fixture-location"]) {
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain(leak);
    }
    expect(built).toBe(0);
    expect(client.requests).toEqual([]);
    expect(h.snapshot()).toBe(before);
  });

  it("configured, with the gate on explicitly: the Vertex adapter over a fake client generates, and the server assembles and activates the plan", async () => {
    const h = setup();
    const client = createFakeGoogleGenAiClient([{ reply: fixtureVertexReply(["breakfast", "lunch", "dinner"]) }]);
    const registry = createNutritionVertexProviderRegistry(FIXTURE_VERTEX_DEPLOYMENT, {
      createClient: () => client,
      newMealId: fixtureMealIds(),
    });

    expect(await h.call({ requestId: RID }, { registry })).toMatchObject({ status: "succeeded", resultPlanId: "gen-plan-1" });
    const plan = h.plan("gen-plan-1");
    expect(plan?.startDate).toBe(TOMORROW);
    expect(plan?.days.map((day) => day.date)).toEqual(Array.from({ length: 7 }, (_, index) => addNutritionDays(TOMORROW, index)));
    expect(plan?.days.flatMap((day) => day.meals.map((meal) => meal.mealId))).toEqual(Array.from({ length: 21 }, (_, index) => `meal-${index + 1}`));
    expect(plan?.days[0].meals.map((meal) => meal.name)).toEqual(["Haferbrei mit Beeren 1", "Linsensuppe mit Brot 1", "Gemüsepfanne mit Reis 1"]);
    // Only the lifecycle's own fields were written: no prompt, reply, project or location anywhere.
    const stored = h.snapshot();
    for (const leak of ["fixture-project", "fixture-location", "systemInstruction", "responseJsonSchema"]) {
      expect(JSON.stringify(h.request(RID))).not.toContain(leak);
      expect(JSON.stringify(h.operation(RID))).not.toContain(leak);
    }
    expect(stored).not.toContain("fixture-project");
    expect(stored).not.toContain("fixture-location");
  });

  it("a reply carrying a meal id is refused before assembly and repaired once; the model's ids are never persisted", async () => {
    const h = setup();
    const injected = fixtureVertexReply(["breakfast", "lunch", "dinner"], (slotId, dayIndex) => ({
      slotId,
      mealId: `model-${slotId}-${dayIndex}`,
      name: "Eintopf",
      values: { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 },
    }));
    const client = createFakeGoogleGenAiClient([{ reply: injected }, { reply: fixtureVertexReply(["breakfast", "lunch", "dinner"]) }]);
    const registry = createNutritionVertexProviderRegistry(FIXTURE_VERTEX_DEPLOYMENT, { createClient: () => client, newMealId: fixtureMealIds() });

    expect(await h.call({ requestId: RID }, { registry })).toMatchObject({ status: "succeeded" });
    expect(client.requests).toHaveLength(2);
    expect(String(client.requests[1].contents)).toContain("must not contain any other field");
    expect(h.snapshot()).not.toContain("model-");
  });

  it("a provider that fails ends the request PROVIDER_FAILED, with none of the provider's message kept", async () => {
    const h = setup();
    const client = createFakeGoogleGenAiClient([{ status: 403 }]);
    const registry = createNutritionVertexProviderRegistry(FIXTURE_VERTEX_DEPLOYMENT, { createClient: () => client });

    expect(await h.call({ requestId: RID }, { registry })).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED" });
    expect(h.snapshot()).not.toContain("fixture-project-123");
    expect(h.snapshot()).not.toContain("ya29");
  });
});
