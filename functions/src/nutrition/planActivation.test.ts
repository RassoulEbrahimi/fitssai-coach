import { describe, it, expect, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { nutritionPlanSchema, nutritionUserStateSchema, type NutritionPlanContent } from "../../../shared/nutrition";
import { fakeFirestore } from "../testing/fakeFirestore";
import {
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY,
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2,
  FIXTURE_NAME_PLAN_VALIDATION_POLICY,
  FIXTURE_REJECTED_MEAL_NAME,
  FIXTURE_REJECT_PLAN_VALIDATION_POLICY,
  fixturePlanValidationPolicyRegistry,
} from "../testing/fixturePlanValidationPolicies";
import {
  CREATED,
  PLANS,
  SOURCE_END,
  SOURCE_START,
  STATE_PATH,
  UID,
  makeContent,
  planPath,
  requestId,
  storedPlan,
  storedState,
  storedTarget,
  targetPath,
} from "../testing/nutritionPlanFixtures";
import { NutritionPlanError } from "./errors";
import { activateNutritionPlan, type NutritionPlanActivationInput } from "./planActivation";
import { productionPlanValidationPolicyRegistry } from "./planValidation/registry";
import type { PlanValidationPolicy } from "./planValidation/types";

/*
  NUT-09: the one plan-activation transaction, against the in-memory Firestore
  with TEST FIXTURE validation policies (they accept or reject by fiat and
  mean nothing). Every refusal is checked to have written nothing at all.
*/

const NOW = new Date("2026-09-28T09:15:00.000Z");
const NEXT_START = "2026-09-30";

type Seed = { state?: Record<string, unknown> | null; plans?: Record<string, Record<string, unknown>>; targets?: string[] };

const setup = (
  seed: Seed = {},
  options: { policies?: readonly PlanValidationPolicy[] | "production"; failWrites?: (path: string) => boolean } = {}
) => {
  const firestore = fakeFirestore({ failWrites: options.failWrites });
  if (seed.state !== null) firestore.docs.set(STATE_PATH, seed.state ?? storedState());
  for (const [id, plan] of Object.entries(seed.plans ?? { "plan-1": storedPlan("plan-1") })) {
    firestore.docs.set(planPath(id), plan);
  }
  for (const id of seed.targets ?? ["target-1"]) firestore.docs.set(targetPath(id), storedTarget(id));

  const policies =
    options.policies === "production"
      ? productionPlanValidationPolicyRegistry
      : fixturePlanValidationPolicyRegistry(options.policies ?? [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2]);
  const deps = { firestore, policies };
  const input = (overrides: Partial<NutritionPlanActivationInput> = {}): NutritionPlanActivationInput => ({
    uid: UID,
    planId: "plan-2",
    content: makeContent(NEXT_START),
    origin: { source: "generated", generationRequestId: null },
    targetVersionId: "target-1",
    expectedActivePlanId: "plan-1",
    reusableValidation: null,
    request: null,
    now: NOW,
    ...overrides,
  });
  const activate = (overrides: Partial<NutritionPlanActivationInput> = {}) => activateNutritionPlan(deps, input(overrides));
  const docs = () => [...firestore.docs.entries()].map(([path, data]) => [path, { ...data }] as const);
  const doc = (path: string) => firestore.docs.get(path) as Record<string, unknown> | undefined;
  return { firestore, deps, activate, docs, doc };
};

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as NutritionPlanError;
  }
  throw new Error("expected a refusal");
};

const code = async (promise: Promise<unknown>) => (await refusal(promise)).code;

/* ------------------------------------------------------------------ *
 * Initial activation
 * ------------------------------------------------------------------ */

describe("the first plan", () => {
  const seed: Seed = { state: storedState({ activePlanId: null, activeGenerationRequestId: "gen-7" }), plans: {} };

  it("creates the plan, moves only the plan pointer and the revision, and touches no other plan", async () => {
    const other = storedPlan("plan-old", {
      lifecycle: { status: "superseded", effectiveUntil: SOURCE_END, supersededByPlanId: "plan-x" },
    });
    const { activate, doc, firestore } = setup({ ...seed, plans: { "plan-old": other } });

    const result = await activate({ expectedActivePlanId: null });

    expect(result).toEqual({ kind: "activated", planId: "plan-2", supersededPlanId: null, revision: 5 });
    expect(doc(STATE_PATH)).toEqual({
      schemaVersion: 2,
      revision: 5,
      activePlanId: "plan-2",
      currentTargetVersionId: "target-1",
      activeGenerationRequestId: "gen-7",
      recentRequests: [],
    });
    expect(doc(planPath("plan-old"))).toBe(other);
    expect(firestore.under(PLANS).map(([path]) => path).sort()).toEqual([planPath("plan-2"), planPath("plan-old")]);
  });

  it("stores a complete, active, immutable plan with server timestamps", async () => {
    const { activate, doc } = setup(seed);
    await activate({ expectedActivePlanId: null });

    const stored = doc(planPath("plan-2")) as Record<string, unknown>;
    expect(stored).toMatchObject({
      schemaVersion: 2,
      planId: "plan-2",
      ...makeContent(NEXT_START),
      targetVersionId: "target-1",
      source: "generated",
      repeatedFromPlanId: null,
      generationRequestId: null,
      validation: { policy: { id: "test-fixture-accept", version: 2 }, outcome: "accepted" },
      lifecycle: { status: "active", effectiveUntil: null, supersededByPlanId: null },
    });
    expect(stored.createdAt).toBeInstanceOf(Timestamp);
    expect((stored.createdAt as Timestamp).toDate()).toEqual(NOW);
    expect(stored.activatedAt).toEqual(stored.createdAt);
    expect(nutritionPlanSchema.safeParse(stored).success).toBe(true);
  });

  it("carries a generation request id when the caller has one", async () => {
    const { activate, doc } = setup(seed);
    await activate({ expectedActivePlanId: null, origin: { source: "generated", generationRequestId: "gen-7" } });
    expect(doc(planPath("plan-2"))?.generationRequestId).toBe("gen-7");
  });
});

/* ------------------------------------------------------------------ *
 * Successor
 * ------------------------------------------------------------------ */

describe("a successor", () => {
  it("supersedes the old plan through its own end when it starts after it", async () => {
    const { activate, doc } = setup();
    const old = doc(planPath("plan-1")) as Record<string, unknown>;
    const before = structuredClone({ ...old, createdAt: null, activatedAt: null, lifecycle: null });

    const result = await activate();

    expect(result).toEqual({ kind: "activated", planId: "plan-2", supersededPlanId: "plan-1", revision: 5 });
    const after = doc(planPath("plan-1")) as Record<string, unknown>;
    expect(after.lifecycle).toEqual({ status: "superseded", effectiveUntil: SOURCE_END, supersededByPlanId: "plan-2" });
    // Everything but the lifecycle is exactly what was stored — the same timestamp objects included.
    expect({ ...after, createdAt: null, activatedAt: null, lifecycle: null }).toEqual(before);
    expect(after.createdAt).toBe(CREATED);
    expect(after.activatedAt).toBe(CREATED);
    expect(Object.keys(after).sort()).toEqual(Object.keys(old).sort());
    expect(nutritionPlanSchema.safeParse(after).success).toBe(true);

    expect(doc(planPath("plan-2"))?.lifecycle).toEqual({ status: "active", effectiveUntil: null, supersededByPlanId: null });
    expect(doc(STATE_PATH)).toMatchObject({ activePlanId: "plan-2", revision: 5, currentTargetVersionId: "target-1" });
  });

  it("leaves the old plan up to the day before a successor that starts inside its week", async () => {
    const { activate, doc } = setup();
    await activate({ content: makeContent("2026-09-26") });
    expect(doc(planPath("plan-1"))?.lifecycle).toEqual({
      status: "superseded",
      effectiveUntil: "2026-09-25",
      supersededByPlanId: "plan-2",
    });
  });

  it("refuses a successor that would leave the old plan no date, and writes nothing", async () => {
    const { activate, docs } = setup();
    const before = docs();
    expect(await code(activate({ content: makeContent(SOURCE_START) }))).toBe("INTERNAL");
    expect(await code(activate({ content: makeContent("2026-09-20") }))).toBe("INTERNAL");
    expect(docs()).toEqual(before);
  });

  it("creates the new plan, never overwriting a document already under its id", async () => {
    const squatter = { squatter: true };
    const { activate, docs } = setup({ plans: { "plan-1": storedPlan("plan-1"), "plan-2": squatter } });
    const before = docs();

    expect(await code(activate())).toBe("INTERNAL");
    expect(docs()).toEqual(before);
  });

  it("records the request in the state ledger", async () => {
    const { activate, doc } = setup();
    await activate({ request: { requestId: requestId(9), operation: "repeatPlan" } });
    expect(doc(STATE_PATH)?.recentRequests).toEqual([
      { requestId: requestId(9), operation: "repeatPlan", resultPlanId: "plan-2" },
    ]);
    expect(nutritionUserStateSchema.safeParse(doc(STATE_PATH)).success).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

describe("validation", () => {
  it("answers PLAN_VALIDATION_POLICY_NOT_CONFIGURED with no policy in force, and writes nothing", async () => {
    const { activate, docs } = setup({}, { policies: [] });
    const before = docs();
    expect(await code(activate())).toBe("PLAN_VALIDATION_POLICY_NOT_CONFIGURED");
    expect(docs()).toEqual(before);
  });

  it("runs target-alignment v1 with the production registry: a week far from its target is PLAN_VALIDATION_FAILED, nothing written", async () => {
    // The fixture week plans about 300 kcal a day against a 1234.5 kcal target.
    const { activate, docs } = setup({}, { policies: "production" });
    const before = docs();
    expect(await code(activate())).toBe("PLAN_VALIDATION_FAILED");
    expect(docs()).toEqual(before);
  });

  it("refuses a rejected plan as PLAN_VALIDATION_FAILED, and writes nothing", async () => {
    const { activate, docs } = setup({}, { policies: [FIXTURE_REJECT_PLAN_VALIDATION_POLICY] });
    const before = docs();
    expect(await code(activate())).toBe("PLAN_VALIDATION_FAILED");
    expect(docs()).toEqual(before);
  });

  it("judges the candidate's content, not its metadata", async () => {
    const content = makeContent(NEXT_START);
    content.days[3].meals[1].name = FIXTURE_REJECTED_MEAL_NAME;
    const { activate } = setup({}, { policies: [FIXTURE_NAME_PLAN_VALIDATION_POLICY] });
    expect(await code(activate({ content }))).toBe("PLAN_VALIDATION_FAILED");
  });

  it("never shows a structurally invalid candidate to the policy, and writes nothing", async () => {
    const validate = vi.fn(() => ({ outcome: "accepted" }));
    const { activate, docs } = setup({}, { policies: [{ id: "spy", version: 1, validate }] });
    const before = docs();
    const sixDays = { ...makeContent(NEXT_START), days: makeContent(NEXT_START).days.slice(0, 6) };
    const negative = makeContent(NEXT_START);
    negative.days[0].meals[0].values.kcal = -1;
    const duplicateMeal = makeContent(NEXT_START);
    duplicateMeal.days[1].meals[0].mealId = duplicateMeal.days[0].meals[0].mealId;

    for (const content of [sixDays, negative, duplicateMeal, { ...makeContent(NEXT_START), extra: 1 }]) {
      expect(await code(activate({ content: content as NutritionPlanContent }))).toBe("INTERNAL");
    }
    expect(validate).not.toHaveBeenCalled();
    expect(docs()).toEqual(before);
  });

  it("gives the policy a frozen copy of the candidate and the target", async () => {
    let seen: unknown;
    const validate = vi.fn((input: unknown) => {
      seen = input;
      expect(() => {
        (input as { plan: NutritionPlanContent }).plan.days[0].meals[0].name = "changed";
      }).toThrow();
      return { outcome: "accepted" };
    });
    const content = makeContent(NEXT_START);
    const copy = structuredClone(content);
    const { activate } = setup({}, { policies: [{ id: "spy", version: 1, validate }] });
    await activate({ content });

    expect(seen).toEqual({ plan: copy, target: expect.objectContaining({ targetVersionId: "target-1" }) });
    expect(content).toEqual(copy);
  });

  it("reuses an acceptance by exactly the policy in force, without running it", async () => {
    const validate = vi.fn(() => ({ outcome: "rejected" }));
    const policy = { id: "test-fixture-accept", version: 1, validate };
    const { activate, doc } = setup({}, { policies: [policy] });
    const reusable = { policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" as const };

    await activate({ reusableValidation: reusable });

    expect(validate).not.toHaveBeenCalled();
    expect(doc(planPath("plan-2"))?.validation).toEqual(reusable);
  });

  it("runs the current policy when the reusable acceptance names another version, and records the current one", async () => {
    const { activate, doc } = setup({}, { policies: [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2] });
    await activate({ reusableValidation: { policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" } });
    expect(doc(planPath("plan-2"))?.validation).toEqual({ policy: { id: "test-fixture-accept", version: 2 }, outcome: "accepted" });

    const rejecting = setup({}, { policies: [FIXTURE_REJECT_PLAN_VALIDATION_POLICY] });
    expect(
      await code(
        rejecting.activate({ reusableValidation: { policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" } })
      )
    ).toBe("PLAN_VALIDATION_FAILED");
  });

  it.each([
    ["throws", () => {
      throw new Error("secret tolerance 1234.5");
    }],
    ["answers prose", () => "looks fine"],
    ["answers extra detail", () => ({ outcome: "accepted", limit: 1234.5 })],
  ])("treats a policy that %s as a bare INTERNAL, and writes nothing", async (_name, validate) => {
    const { activate, docs } = setup({}, { policies: [{ id: "broken", version: 1, validate }] });
    const before = docs();
    const error = await refusal(activate());
    expect(error.code).toBe("INTERNAL");
    expect(error.message).not.toMatch(/secret|1234/);
    expect(docs()).toEqual(before);
  });

  it("refuses a misconfigured policy reference", async () => {
    const { activate } = setup({}, { policies: [{ id: "Not An Id", version: 0, validate: () => ({ outcome: "accepted" }) }] });
    expect(await code(activate())).toBe("INTERNAL");
    expect(() =>
      fixturePlanValidationPolicyRegistry([FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY, FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2])
    ).toThrow(/more than one/);
  });
});

/* ------------------------------------------------------------------ *
 * Stale assumptions and integrity
 * ------------------------------------------------------------------ */

describe("stale assumptions", () => {
  it("refuses when another plan is active now, and writes nothing", async () => {
    const { activate, docs } = setup();
    const before = docs();
    expect(await code(activate({ expectedActivePlanId: "plan-0" }))).toBe("STALE_ACTIVE_PLAN");
    expect(await code(activate({ expectedActivePlanId: null }))).toBe("STALE_ACTIVE_PLAN");
    expect(docs()).toEqual(before);
  });

  it("refuses when the target pointer moved, and writes nothing", async () => {
    const { activate, docs } = setup({ state: storedState({ currentTargetVersionId: "target-2" }), targets: ["target-1", "target-2"] });
    const before = docs();
    expect(await code(activate({ targetVersionId: "target-1" }))).toBe("STALE_TARGET");
    expect(docs()).toEqual(before);
  });

  it("refuses without a state at all", async () => {
    const { activate, docs } = setup({ state: null, plans: {} });
    expect(await code(activate({ expectedActivePlanId: null }))).toBe("STALE_TARGET");
    expect(docs().filter(([path]) => !path.startsWith(`users/${UID}/nutrition_v2_targets/`))).toEqual([]);
  });

  it("lets exactly one of two activations built on the same state win", async () => {
    const { deps, firestore, doc } = setup();
    const base = {
      uid: UID,
      content: makeContent(NEXT_START),
      origin: { source: "generated" as const, generationRequestId: null },
      targetVersionId: "target-1",
      expectedActivePlanId: "plan-1",
      reusableValidation: null,
      request: null,
      now: NOW,
    };
    const results = await Promise.allSettled([
      activateNutritionPlan(deps, { ...base, planId: "plan-a" }),
      activateNutritionPlan(deps, { ...base, planId: "plan-b" }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(((results[1] as PromiseRejectedResult).reason as NutritionPlanError).code).toBe("STALE_ACTIVE_PLAN");
    expect(firestore.under(PLANS).map(([path]) => path).sort()).toEqual([planPath("plan-1"), planPath("plan-a")]);
    expect(doc(STATE_PATH)).toMatchObject({ activePlanId: "plan-a", revision: 5 });
  });
});

describe("integrity", () => {
  it.each([
    ["the target is missing", { targets: [] }],
    ["the target is malformed", { targets: ["target-1"], malformTarget: true }],
    ["the active plan is missing", { plans: {} }],
    ["the active plan is malformed", { plans: { "plan-1": { ...storedPlan("plan-1"), lifecycle: undefined } } }],
    ["the active plan is stored under another id", { plans: { "plan-1": storedPlan("plan-9") } }],
    ["the state is malformed", { state: { schemaVersion: 2, activePlanId: "plan-1" } }],
  ])("is an INTERNAL failure when %s, and writes nothing", async (_name, seed) => {
    const { activate, docs, firestore } = setup(seed as Seed);
    if ((seed as { malformTarget?: boolean }).malformTarget) {
      firestore.docs.set(targetPath("target-1"), { ...storedTarget("target-1"), values: { kcal: -1 } });
    }
    const before = docs();
    expect(await code(activate())).toBe("INTERNAL");
    expect(docs()).toEqual(before);
  });

  it("refuses when the state points to a plan that is already superseded", async () => {
    const superseded = storedPlan("plan-1", {
      lifecycle: { status: "superseded", effectiveUntil: SOURCE_END, supersededByPlanId: "plan-x" },
    });
    const { activate, docs } = setup({ plans: { "plan-1": superseded } });
    const before = docs();
    expect(await code(activate())).toBe("PLAN_NOT_ACTIVE");
    expect(docs()).toEqual(before);
  });

  it("refuses malformed input before any read", async () => {
    const { activate, docs } = setup();
    const before = docs();
    for (const overrides of [
      { planId: "../evil" },
      { planId: "plan-1" },
      { targetVersionId: "" },
      { uid: "" },
      { now: new Date(Number.NaN) },
      { origin: { source: "repeated" as const, repeatedFromPlanId: "" } },
    ]) {
      expect(await code(activate(overrides as Partial<NutritionPlanActivationInput>)), JSON.stringify(overrides)).toBe("INTERNAL");
    }
    expect(docs()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Atomicity and replay
 * ------------------------------------------------------------------ */

describe("atomicity", () => {
  it.each([
    ["the state write", STATE_PATH],
    ["the old plan's lifecycle write", planPath("plan-1")],
    ["the new plan's create", planPath("plan-2")],
  ])("leaves no partial plan, lifecycle or state when %s fails", async (_name, failing) => {
    const { activate, docs } = setup({}, { failWrites: (path) => path === failing });
    const before = docs();
    expect(await code(activate())).toBe("INTERNAL");
    expect(docs()).toEqual(before);
  });
});

describe("replay inside the transaction", () => {
  const applied = storedState({
    activePlanId: "plan-2",
    revision: 5,
    recentRequests: [{ requestId: requestId(1), operation: "repeatPlan", resultPlanId: "plan-2" }],
  });

  it("answers an applied request with its plan, and writes nothing", async () => {
    const { activate, docs } = setup({
      state: applied,
      plans: { "plan-1": storedPlan("plan-1"), "plan-2": storedPlan("plan-2", { startDate: NEXT_START }) },
    });
    const before = docs();
    const result = await activate({ planId: "plan-3", request: { requestId: requestId(1), operation: "repeatPlan" } });
    expect(result).toEqual({ kind: "replay", planId: "plan-2" });
    expect(docs()).toEqual(before);
  });

  it("is INTERNAL when the ledger names a plan that is missing, and creates no replacement", async () => {
    const { activate, docs } = setup({ state: applied });
    const before = docs();
    expect(await code(activate({ planId: "plan-3", request: { requestId: requestId(1), operation: "repeatPlan" } }))).toBe(
      "INTERNAL"
    );
    expect(docs()).toEqual(before);
  });

  it("refuses a request id that another operation applied", async () => {
    const { activate } = setup({
      state: storedState({ recentRequests: [{ requestId: requestId(1), operation: "setTarget", resultTargetVersionId: "target-1" }] }),
    });
    expect(await code(activate({ request: { requestId: requestId(1), operation: "repeatPlan" } }))).toBe("INVALID_REQUEST");
  });
});

/* ------------------------------------------------------------------ *
 * NUT-11: the same core, completing a generation request
 * ------------------------------------------------------------------ */

describe("an activation that completes a generation request (NUT-11)", () => {
  const GEN = "00000000-0000-4000-8000-000000000077";
  const generated = { origin: { source: "generated" as const, generationRequestId: GEN }, completesGenerationRequestId: GEN };

  it("clears the generation pointer in the same state write: one revision", async () => {
    const { activate, doc } = setup({ state: storedState({ activeGenerationRequestId: GEN }) });
    expect(await activate(generated)).toEqual({ kind: "activated", planId: "plan-2", supersededPlanId: "plan-1", revision: 5 });
    expect(doc(STATE_PATH)).toMatchObject({ revision: 5, activePlanId: "plan-2", activeGenerationRequestId: null, recentRequests: [] });
    expect(doc(planPath("plan-2"))).toMatchObject({ generationRequestId: GEN, source: "generated" });
  });

  it("refuses, writing nothing, when the state no longer names that generation", async () => {
    for (const pointer of [null, "00000000-0000-4000-8000-000000000078"]) {
      const { activate, docs } = setup({ state: storedState({ activeGenerationRequestId: pointer }) });
      const before = docs();
      expect(await code(activate(generated))).toBe("INTERNAL");
      expect(docs()).toEqual(before);
    }
  });

  it("refuses a completion by a plan the request did not produce", async () => {
    const { activate, docs } = setup({ state: storedState({ activeGenerationRequestId: GEN }) });
    const before = docs();
    expect(await code(activate({ completesGenerationRequestId: GEN }))).toBe("INTERNAL");
    expect(await code(activate({ origin: { source: "repeated", repeatedFromPlanId: "plan-1" }, completesGenerationRequestId: GEN }))).toBe("INTERNAL");
    expect(docs()).toEqual(before);
  });

  it("leaves the pointer alone when the activation completes no generation (repeat's path)", async () => {
    const { activate, doc } = setup({ state: storedState({ activeGenerationRequestId: GEN }) });
    await activate();
    expect(doc(STATE_PATH)).toMatchObject({ revision: 5, activeGenerationRequestId: GEN });
  });
});
