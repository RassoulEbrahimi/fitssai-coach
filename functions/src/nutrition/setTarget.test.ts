import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  NUTRITION_STATE_REQUEST_LEDGER_SIZE,
  nutritionTargetFingerprintMaterial,
  nutritionUserStateSchema,
  targetVersionSchema,
  type NutritionUserState,
} from "../../../shared/nutrition";
import { fakeFirestore } from "../testing/fakeFirestore";
import {
  FIXTURE_CALCULATED_POLICY,
  FIXTURE_MANUAL_POLICY,
  fixtureTargetPolicyRegistry,
} from "../testing/fixtureTargetPolicies";
import { appendNutritionStateRequest, handleNutritionSetTarget, planSetTargetTransition } from "./setTarget";
import { NutritionTargetError, toNutritionHttpsError } from "./errors";
import { nodeSha256Hex } from "./sha256";
import { PRODUCTION_TARGET_POLICIES, productionTargetPolicyRegistry } from "./targetPolicy/registry";
import type { TargetPolicy } from "./targetPolicy/types";

/*
  NUT-08: `nutritionSetTarget`, end to end against the in-memory Firestore.

  Production has no target policy, so the deployed handler can only answer
  TARGET_POLICY_NOT_CONFIGURED; that path is pinned first. Everything else is
  exercised with the TEST FIXTURE policies from src/testing/, whose numbers
  mean nothing.
*/

const UID = "alice";
const OTHER = "bob";
const STATE_PATH = `users/${UID}/nutrition_v2_state/current`;
const TARGETS = `users/${UID}/nutrition_v2_targets/`;
const targetPath = (id: string) => TARGETS + id;

/** 22:30 UTC on 27 Sep is already 28 Sep in Berlin (CEST): UTC slicing would be wrong. */
const NOW = new Date("2026-09-27T22:30:00.000Z");
const BERLIN_DAY = "2026-09-28";

const requestId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ADULT_PROFILE = {
  fullName: "Alice Example",
  email: "alice@example.com",
  age: 34,
  height: 172.5,
  weight: 68.25,
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  fitnessGoal: "lose-fat",
  nutritionTargetMode: "calculated",
  manualTargetKcal: 1950.5,
  dietaryPreference: "vegan",
  mealsPerDay: 4,
};

const setup = (
  profile: Record<string, unknown> | null = ADULT_PROFILE,
  options: { failWrites?: (path: string) => boolean; policies?: readonly TargetPolicy[] | "production" } = {}
) => {
  const firestore = fakeFirestore({ failWrites: options.failWrites });
  if (profile) firestore.docs.set(`users/${UID}`, { ...profile });
  let minted = 0;
  const deps = {
    firestore,
    policies:
      options.policies === "production"
        ? productionTargetPolicyRegistry
        : fixtureTargetPolicyRegistry(options.policies ?? [FIXTURE_CALCULATED_POLICY, FIXTURE_MANUAL_POLICY]),
    now: () => NOW,
    newTargetId: () => `target-${(minted += 1)}`,
  };
  const call = (data: unknown, uid: string | null = UID) =>
    handleNutritionSetTarget(uid === null ? { data } : { auth: { uid }, data }, deps);
  const nutritionDocs = () => firestore.under(`users/${UID}/nutrition_v2_`);
  const state = () => firestore.docs.get(STATE_PATH) as NutritionUserState | undefined;
  const target = (id: string) => firestore.docs.get(targetPath(id));
  return { firestore, deps, call, nutritionDocs, state, target };
};

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
};

const code = async (promise: Promise<unknown>) => ((await refusal(promise)) as NutritionTargetError).code;

afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ *
 * Production: an empty registry
 * ------------------------------------------------------------------ */

describe("the production registry", () => {
  it("contains zero policies and resolves neither mode", () => {
    expect(PRODUCTION_TARGET_POLICIES).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_TARGET_POLICIES)).toBe(true);
    expect(productionTargetPolicyRegistry.get("calculated")).toBeNull();
    expect(productionTargetPolicyRegistry.get("manual")).toBeNull();
  });

  it.each(["calculated", "manual"] as const)("answers TARGET_POLICY_NOT_CONFIGURED for an adult asking for %s", async (mode) => {
    const { call, nutritionDocs } = setup(ADULT_PROFILE, { policies: "production" });

    expect(await code(call({ mode, requestId: requestId(1) }))).toBe("TARGET_POLICY_NOT_CONFIGURED");
    // No state, no target: nothing is created for a refusal.
    expect(nutritionDocs()).toEqual([]);
  });

  it("maps the refusal to a neutral failed-precondition with the code as its only message", async () => {
    const { call } = setup(ADULT_PROFILE, { policies: "production" });
    const error = toNutritionHttpsError(await refusal(call({ mode: "manual", requestId: requestId(1) })));

    expect(error.code).toBe("failed-precondition");
    expect(error.message).toBe("TARGET_POLICY_NOT_CONFIGURED");
    expect(error.details).toBeUndefined();
  });

  it("does not invent required fields for an unsigned formula", async () => {
    // Nothing at all in the profile but an adult age: still NOT_CONFIGURED,
    // never a PROFILE_INCOMPLETE list derived from a guessed formula.
    const { call } = setup({ age: 40 }, { policies: "production" });
    expect(await code(call({ mode: "calculated", requestId: requestId(1) }))).toBe("TARGET_POLICY_NOT_CONFIGURED");
  });
});

/* ------------------------------------------------------------------ *
 * Auth, request and eligibility
 * ------------------------------------------------------------------ */

describe("who may set a target", () => {
  it("refuses a signed-out call before reading anything", async () => {
    const { call, nutritionDocs } = setup();
    const error = await refusal(call({ mode: "calculated", requestId: requestId(1) }, null));

    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe("unauthenticated");
    expect(nutritionDocs()).toEqual([]);
  });

  it.each([
    ["a minor", { ...ADULT_PROFILE, age: 17 }, "minor"],
    ["a missing age", { ...ADULT_PROFILE, age: undefined }, "missingAge"],
    ["an invalid age", { ...ADULT_PROFILE, age: "34" }, "missingAge"],
    ["no profile document", null, "missingAge"],
  ])("refuses %s as NOT_ELIGIBLE with the reason code only", async (_name, profile, reason) => {
    const { call, nutritionDocs } = setup(profile as Record<string, unknown> | null);
    const error = (await refusal(call({ mode: "calculated", requestId: requestId(1) }))) as NutritionTargetError;

    expect(error.code).toBe("NOT_ELIGIBLE");
    expect(error.details).toEqual({ reason });
    expect(nutritionDocs()).toEqual([]);
  });

  it("uses the token's uid, never one from the request", async () => {
    const { call, firestore } = setup();
    firestore.docs.set(`users/${OTHER}`, { ...ADULT_PROFILE });

    // A uid in the data is not merely ignored: the strict request refuses it.
    expect(await code(call({ mode: "calculated", requestId: requestId(1), uid: OTHER }))).toBe("INVALID_REQUEST");
    expect(firestore.under(`users/${OTHER}/`)).toEqual([]);
  });

  it.each([
    ["no data", undefined],
    ["an unknown mode", { mode: "auto", requestId: requestId(1) }],
    ["an upper-case request id", { mode: "manual", requestId: "3F2B8C1E-9A4D-4E6F-8B21-7C5D0E9A1B34" }],
    ["a non-UUID request id", { mode: "manual", requestId: "abc" }],
    ["a profile", { mode: "calculated", requestId: requestId(1), profile: { weight: 60 } }],
    ["a weight", { mode: "calculated", requestId: requestId(1), weight: 60 }],
    ["a manual kcal", { mode: "manual", requestId: requestId(1), manualTargetKcal: 9000 }],
    ["target values", { mode: "manual", requestId: requestId(1), values: { kcal: 1 } }],
    ["a target id", { mode: "manual", requestId: requestId(1), targetVersionId: "mine" }],
  ])("refuses a request with %s as INVALID_REQUEST", async (_name, data) => {
    const { call, nutritionDocs } = setup();
    expect(await code(call(data))).toBe("INVALID_REQUEST");
    expect(nutritionDocs()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Profile inputs
 * ------------------------------------------------------------------ */

describe("required profile fields", () => {
  it("names missing and invalid fields, and only names", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const errorLog = vi.spyOn(console, "error");
    const { call, nutritionDocs } = setup({ ...ADULT_PROFILE, height: undefined, weight: -3, activityLevel: "sehr aktiv" });
    const error = (await refusal(call({ mode: "calculated", requestId: requestId(1) }))) as NutritionTargetError;

    expect(error.code).toBe("PROFILE_INCOMPLETE");
    expect(error.details).toEqual({ missingFields: ["height"], invalidFields: ["activityLevel", "weight"] });
    const exposed = JSON.stringify(toNutritionHttpsError(error).toJSON()) + error.message;
    expect(exposed).not.toMatch(/-3|sehr aktiv|68\.25|172\.5|female|Alice|alice@/);
    expect(nutritionDocs()).toEqual([]);
    expect([...log.mock.calls, ...warn.mock.calls, ...errorLog.mock.calls]).toEqual([]);
  });

  it("asks a manual policy only for its own field", async () => {
    const { call } = setup({ age: 30, manualTargetKcal: 0 });
    const error = (await refusal(call({ mode: "manual", requestId: requestId(1) }))) as NutritionTargetError;

    expect(error.details).toEqual({ missingFields: [], invalidFields: ["manualTargetKcal"] });
  });

  it("never reads generation inputs that no policy requires", async () => {
    const without = setup({ ...ADULT_PROFILE, dietaryPreference: undefined, mealsPerDay: undefined });
    await without.call({ mode: "calculated", requestId: requestId(1) });

    const withThem = setup(ADULT_PROFILE);
    await withThem.call({ mode: "calculated", requestId: requestId(1) });

    expect(without.target("target-1")?.profileFingerprint).toEqual(withThem.target("target-1")?.profileFingerprint);
  });
});

/* ------------------------------------------------------------------ *
 * Creating a target
 * ------------------------------------------------------------------ */

describe("a new target", () => {
  it("creates an immutable calculated TargetVersion with provenance", async () => {
    const { call, target } = setup();
    const result = await call({ mode: "calculated", requestId: requestId(1) });

    expect(result).toEqual({ ok: true, targetVersionId: "target-1", replay: false });
    const stored = target("target-1") as Record<string, unknown>;
    expect(stored).toMatchObject({
      schemaVersion: 2,
      targetVersionId: "target-1",
      mode: "calculated",
      // Fixture arithmetic, stored unrounded.
      values: { kcal: 1000.5 + 68.25 + 172.5, proteinG: 11.25, carbsG: 22.5, fatG: 33.75 },
      effectiveFrom: BERLIN_DAY,
      effectiveOrder: 1,
      policy: { id: "test-fixture-calculated", version: 1 },
      supersedesTargetVersionId: null,
    });
    expect(stored.createdAt).toBeInstanceOf(Timestamp);
    expect((stored.createdAt as Timestamp).toDate()).toEqual(NOW);
    // What a client reads back is a valid V2 TargetVersion.
    expect(targetVersionSchema.safeParse(stored).success).toBe(true);
  });

  it("creates a manual TargetVersion in the same shape", async () => {
    const { call, target } = setup();
    await call({ mode: "manual", requestId: requestId(1) });

    const stored = target("target-1") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(
      [
        "createdAt",
        "effectiveFrom",
        "effectiveOrder",
        "mode",
        "policy",
        "profileFingerprint",
        "schemaVersion",
        "supersedesTargetVersionId",
        "targetVersionId",
        "values",
      ].sort()
    );
    expect(stored).toMatchObject({
      mode: "manual",
      values: { kcal: 1950.5, proteinG: 1.5, carbsG: 2.5, fatG: 3.5 },
      policy: { id: "test-fixture-manual", version: 1 },
      profileFingerprint: { fields: ["manualTargetKcal"] },
    });
  });

  it("fingerprints the inputs as a SHA-256 of names and values, and persists names only", async () => {
    const { call, target } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });

    const fingerprint = (target("target-1") as { profileFingerprint: { hash: string; fields: string[] } }).profileFingerprint;
    const expected = await nodeSha256Hex(
      nutritionTargetFingerprintMaterial({
        mode: "calculated",
        policy: { id: "test-fixture-calculated", version: 1 },
        fields: ["weight", "height", "biologicalSex", "activityLevel", "fitnessGoal"],
        values: { weight: 68.25, height: 172.5, biologicalSex: "female", activityLevel: "moderatelyActive", fitnessGoal: "loseFat" },
      })
    );

    expect(fingerprint).toEqual({
      hash: expected,
      fields: ["activityLevel", "biologicalSex", "fitnessGoal", "height", "weight"],
    });
    expect(Object.keys(fingerprint).sort()).toEqual(["fields", "hash"]);
    // No raw biometric in the stored target outside `values`.
    const { values: _values, ...rest } = target("target-1") as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toMatch(/68\.25|172\.5|"female"|moderatelyActive|loseFat|lose-fat|"34"/);
  });

  it("rejects a policy result that is not canonical NutritionValues, and writes nothing", async () => {
    for (const bad of [
      { kcal: -1, proteinG: 1, carbsG: 1, fatG: 1 },
      { kcal: Number.NaN, proteinG: 1, carbsG: 1, fatG: 1 },
      { kcal: 1, proteinG: 1, carbsG: 1 },
      { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 2 },
      "2000",
    ]) {
      const policy: TargetPolicy = { ...FIXTURE_MANUAL_POLICY, compute: () => bad };
      const { call, nutritionDocs } = setup(ADULT_PROFILE, { policies: [policy] });
      expect(await code(call({ mode: "manual", requestId: requestId(1) }))).toBe("INTERNAL");
      expect(nutritionDocs()).toEqual([]);
    }
  });

  it("turns a throwing policy into a bare INTERNAL", async () => {
    const policy: TargetPolicy = {
      ...FIXTURE_MANUAL_POLICY,
      compute: () => {
        throw new Error("secret policy detail 1950.5");
      },
    };
    const { call, nutritionDocs } = setup(ADULT_PROFILE, { policies: [policy] });
    const error = toNutritionHttpsError(await refusal(call({ mode: "manual", requestId: requestId(1) })));

    expect(error.code).toBe("internal");
    expect(error.message).toBe("INTERNAL");
    expect(JSON.stringify(error.toJSON())).not.toMatch(/secret|1950/);
    expect(nutritionDocs()).toEqual([]);
  });

  it("gives a policy only its required fields, frozen", async () => {
    let seen: unknown;
    const policy: TargetPolicy = {
      ...FIXTURE_MANUAL_POLICY,
      compute: (input) => {
        seen = input;
        expect(() => {
          (input.profile as Record<string, unknown>).manualTargetKcal = 1;
        }).toThrow();
        return { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 };
      },
    };
    const { call } = setup(ADULT_PROFILE, { policies: [policy] });
    await call({ mode: "manual", requestId: requestId(1) });

    expect(seen).toEqual({ mode: "manual", profile: { manualTargetKcal: 1950.5 } });
  });

  it("refuses a misconfigured registry rather than running the wrong policy", async () => {
    const misfiled: TargetPolicy = { ...FIXTURE_MANUAL_POLICY };
    const deps = setup().deps;
    const wrongMode = { ...deps, policies: { get: () => misfiled } };

    expect(await code(handleNutritionSetTarget({ auth: { uid: UID }, data: { mode: "calculated", requestId: requestId(1) } }, wrongMode))).toBe(
      "INTERNAL"
    );
    expect(() => fixtureTargetPolicyRegistry([FIXTURE_MANUAL_POLICY, FIXTURE_MANUAL_POLICY])).toThrow(/more than one/);
  });

  it("server-generates the target id, distinct from the request id", async () => {
    const firestore = fakeFirestore();
    firestore.docs.set(`users/${UID}`, { ...ADULT_PROFILE });
    const result = await handleNutritionSetTarget(
      { auth: { uid: UID }, data: { mode: "manual", requestId: requestId(1) } },
      { firestore, policies: fixtureTargetPolicyRegistry(), now: () => NOW }
    );

    expect(result.targetVersionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(result.targetVersionId).not.toBe(requestId(1));
  });
});

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

describe("the account state", () => {
  it("is created by the first target, atomically, at revision 1", async () => {
    const { call, state } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });

    expect(state()).toEqual({
      schemaVersion: 2,
      revision: 1,
      activePlanId: null,
      currentTargetVersionId: "target-1",
      activeGenerationRequestId: null,
      recentRequests: [{ requestId: requestId(1), operation: "setTarget", resultTargetVersionId: "target-1" }],
    });
    expect(nutritionUserStateSchema.safeParse(state()).success).toBe(true);
  });

  it("keeps the plan and generation pointers and moves the target pointer", async () => {
    const { call, firestore, state, target } = setup();
    firestore.docs.set(STATE_PATH, {
      schemaVersion: 2,
      revision: 7,
      activePlanId: "plan-9",
      currentTargetVersionId: "target-0",
      activeGenerationRequestId: "gen-3",
      recentRequests: [],
    });
    await call({ mode: "manual", requestId: requestId(1) });

    expect(state()).toMatchObject({
      revision: 8,
      activePlanId: "plan-9",
      activeGenerationRequestId: "gen-3",
      currentTargetVersionId: "target-1",
    });
    expect(target("target-1")).toMatchObject({ effectiveOrder: 8, supersedesTargetVersionId: "target-0" });
  });

  it("refuses to build on a malformed state, and writes nothing", async () => {
    const { call, firestore, nutritionDocs } = setup();
    const malformed = { schemaVersion: 2, activePlanId: null, currentTargetVersionId: null, activeGenerationRequestId: null };
    firestore.docs.set(STATE_PATH, malformed);

    expect(await code(call({ mode: "manual", requestId: requestId(1) }))).toBe("INTERNAL");
    expect(nutritionDocs()).toEqual([[STATE_PATH, malformed]]);
  });

  it("changes no revision when a request is refused", async () => {
    const { call, state, firestore } = setup();
    await call({ mode: "manual", requestId: requestId(1) });
    firestore.docs.set(`users/${UID}`, { ...ADULT_PROFILE, manualTargetKcal: null });

    expect(await code(call({ mode: "manual", requestId: requestId(2) }))).toBe("PROFILE_INCOMPLETE");
    expect(state()?.revision).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Versioning
 * ------------------------------------------------------------------ */

describe("target versions", () => {
  it("creates a second version and leaves the first byte-for-byte unchanged", async () => {
    const { call, firestore, state, target } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    const first = target("target-1");
    const firstCopy = structuredClone({ ...first, createdAt: null });

    firestore.docs.set(`users/${UID}`, { ...ADULT_PROFILE, weight: 70 });
    await call({ mode: "calculated", requestId: requestId(2) });

    expect(target("target-1")).toBe(first);
    expect({ ...target("target-1"), createdAt: null }).toEqual(firstCopy);
    expect(target("target-2")).toMatchObject({
      supersedesTargetVersionId: "target-1",
      effectiveFrom: BERLIN_DAY,
      effectiveOrder: 2,
    });
    expect(state()).toMatchObject({ revision: 2, currentTargetVersionId: "target-2" });
    // Same Berlin day: effectiveOrder, not the date, orders them.
    expect((target("target-2") as { effectiveOrder: number }).effectiveOrder).toBeGreaterThan(
      (target("target-1") as { effectiveOrder: number }).effectiveOrder
    );
  });

  it("changing the profile alone rewrites no target and no state", async () => {
    const { call, firestore, nutritionDocs } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    const before = structuredClone(nutritionDocs().map(([path, data]) => [path, JSON.stringify(data)]));

    firestore.docs.set(`users/${UID}`, { ...ADULT_PROFILE, weight: 90 });

    expect(nutritionDocs().map(([path, data]) => [path, JSON.stringify(data)])).toEqual(before);
  });

  it("a switch of mode is a new version too", async () => {
    const { call, target, state } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    await call({ mode: "manual", requestId: requestId(2) });

    expect(target("target-2")).toMatchObject({ mode: "manual", supersedesTargetVersionId: "target-1", effectiveOrder: 2 });
    expect(state()?.currentTargetVersionId).toBe("target-2");
  });
});

/* ------------------------------------------------------------------ *
 * Idempotency
 * ------------------------------------------------------------------ */

describe("request idempotency", () => {
  it("returns the original target for a repeated request id and writes nothing", async () => {
    const { call, firestore, nutritionDocs, state } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    const before = nutritionDocs();

    const again = await call({ mode: "calculated", requestId: requestId(1) });

    expect(again).toEqual({ ok: true, targetVersionId: "target-1", replay: true });
    expect(nutritionDocs()).toEqual(before);
    expect(state()?.revision).toBe(1);
    expect(state()?.recentRequests).toHaveLength(1);
    expect(firestore.under(TARGETS)).toHaveLength(1);
  });

  it("replays even after the profile or the policies changed", async () => {
    const { call, firestore, deps } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    firestore.docs.set(`users/${UID}`, { age: 34 });

    const replay = await handleNutritionSetTarget(
      { auth: { uid: UID }, data: { mode: "calculated", requestId: requestId(1) } },
      { ...deps, policies: productionTargetPolicyRegistry }
    );
    expect(replay).toEqual({ ok: true, targetVersionId: "target-1", replay: true });
  });

  it("keeps revision 2 for a replay of the second request", async () => {
    const { call, state, firestore } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    await call({ mode: "calculated", requestId: requestId(2) });

    expect(await call({ mode: "calculated", requestId: requestId(2) })).toMatchObject({ targetVersionId: "target-2", replay: true });
    expect(state()?.revision).toBe(2);
    expect(firestore.under(TARGETS)).toHaveLength(2);
  });

  it("refuses the same request id for another mode", async () => {
    const { call } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    expect(await code(call({ mode: "manual", requestId: requestId(1) }))).toBe("INVALID_REQUEST");
  });

  it("is an integrity failure when the ledger names a missing target, and creates no replacement", async () => {
    const { call, firestore, state } = setup();
    await call({ mode: "calculated", requestId: requestId(1) });
    firestore.docs.delete(targetPath("target-1"));

    expect(await code(call({ mode: "calculated", requestId: requestId(1) }))).toBe("INTERNAL");
    expect(firestore.under(TARGETS)).toEqual([]);
    expect(state()?.revision).toBe(1);
  });

  it("converges concurrent duplicates on one target", async () => {
    const { call, firestore, state } = setup();
    const results = await Promise.all([
      call({ mode: "calculated", requestId: requestId(1) }),
      call({ mode: "calculated", requestId: requestId(1) }),
      call({ mode: "calculated", requestId: requestId(1) }),
    ]);

    expect(new Set(results.map((result) => result.targetVersionId)).size).toBe(1);
    expect(results.filter((result) => !result.replay)).toHaveLength(1);
    expect(firestore.under(TARGETS)).toHaveLength(1);
    expect(state()?.revision).toBe(1);
    expect(state()?.recentRequests).toHaveLength(1);
  });

  it("orders concurrent distinct requests by revision", async () => {
    const { call, state, firestore } = setup();
    await Promise.all([call({ mode: "calculated", requestId: requestId(1) }), call({ mode: "manual", requestId: requestId(2) })]);

    const orders = firestore.under(TARGETS).map(([, data]) => data.effectiveOrder).sort();
    expect(orders).toEqual([1, 2]);
    expect(state()?.revision).toBe(2);
  });

  it(`keeps a bounded ledger of ${NUTRITION_STATE_REQUEST_LEDGER_SIZE}, evicting the oldest`, async () => {
    const { call, state } = setup();
    const total = NUTRITION_STATE_REQUEST_LEDGER_SIZE + 3;
    for (let n = 1; n <= total; n += 1) await call({ mode: "manual", requestId: requestId(n) });

    expect(state()?.revision).toBe(total);
    expect(state()?.recentRequests.map((request) => request.requestId)).toEqual(
      Array.from({ length: NUTRITION_STATE_REQUEST_LEDGER_SIZE }, (_, index) => requestId(index + 4))
    );
    expect(nutritionUserStateSchema.safeParse(state()).success).toBe(true);
  });

  it("appends and evicts deterministically", () => {
    const entry = (n: number) => ({ requestId: requestId(n), operation: "setTarget" as const, resultTargetVersionId: `t-${n}` });
    const full = Array.from({ length: NUTRITION_STATE_REQUEST_LEDGER_SIZE }, (_, index) => entry(index + 1));
    const frozen = Object.freeze([...full]);

    const next = appendNutritionStateRequest(frozen, entry(99));
    expect(next).toHaveLength(NUTRITION_STATE_REQUEST_LEDGER_SIZE);
    expect(next[0]).toEqual(entry(2));
    expect(next.at(-1)).toEqual(entry(99));
    expect(frozen).toHaveLength(NUTRITION_STATE_REQUEST_LEDGER_SIZE);
  });

  it("plans a replay without touching the state", () => {
    const state: NutritionUserState = {
      schemaVersion: 2,
      revision: 3,
      activePlanId: null,
      currentTargetVersionId: "t-3",
      activeGenerationRequestId: null,
      recentRequests: [{ requestId: requestId(1), operation: "setTarget", resultTargetVersionId: "t-1" }],
    };
    const input = {
      requestId: requestId(1),
      targetVersionId: "t-new",
      mode: "manual" as const,
      values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 },
      effectiveFrom: BERLIN_DAY,
      policy: { id: "p", version: 1 },
      profileFingerprint: { hash: "0".repeat(64), fields: [] },
    };
    expect(planSetTargetTransition(state, input)).toEqual({ kind: "replay", targetVersionId: "t-1" });
  });
});

/* ------------------------------------------------------------------ *
 * Atomicity
 * ------------------------------------------------------------------ */

describe("atomicity", () => {
  it("leaves neither a target nor a state when the state write fails", async () => {
    const { call, nutritionDocs } = setup(ADULT_PROFILE, { failWrites: (path) => path === STATE_PATH });

    expect(await code(call({ mode: "calculated", requestId: requestId(1) }))).toBe("INTERNAL");
    expect(nutritionDocs()).toEqual([]);
  });

  it("leaves the previous target and state untouched when a later commit fails", async () => {
    let fail = false;
    const { call, nutritionDocs, state } = setup(ADULT_PROFILE, { failWrites: (path) => fail && path === STATE_PATH });
    await call({ mode: "calculated", requestId: requestId(1) });
    const before = nutritionDocs();

    fail = true;
    expect(await code(call({ mode: "calculated", requestId: requestId(2) }))).toBe("INTERNAL");
    expect(nutritionDocs()).toEqual(before);
    expect(state()?.revision).toBe(1);
  });

  it("never overwrites an existing target document", async () => {
    const { call, firestore, nutritionDocs } = setup();
    firestore.docs.set(targetPath("target-1"), { squatter: true });

    expect(await code(call({ mode: "calculated", requestId: requestId(1) }))).toBe("INTERNAL");
    expect(nutritionDocs()).toEqual([[targetPath("target-1"), { squatter: true }]]);
  });
});

/* ------------------------------------------------------------------ *
 * Error mapping
 * ------------------------------------------------------------------ */

describe("toNutritionHttpsError", () => {
  it.each([
    ["INVALID_REQUEST", "invalid-argument"],
    ["NOT_ELIGIBLE", "permission-denied"],
    ["TARGET_POLICY_NOT_CONFIGURED", "failed-precondition"],
    ["PROFILE_INCOMPLETE", "failed-precondition"],
    ["INTERNAL", "internal"],
  ] as const)("maps %s to %s with the code as message", (errorCode, httpsCode) => {
    const error = toNutritionHttpsError(new NutritionTargetError(errorCode, "internal description"));
    expect(error.code).toBe(httpsCode);
    expect(error.message).toBe(errorCode);
  });

  it("hides anything it does not recognise", () => {
    const error = toNutritionHttpsError(new Error("users/alice/nutrition_v2_state/current: PERMISSION_DENIED"));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("INTERNAL");
    expect(error.details).toBeUndefined();
  });

  it("passes an unauthenticated refusal through", () => {
    const original = new HttpsError("unauthenticated", "Authentication required.");
    expect(toNutritionHttpsError(original)).toBe(original);
  });
});
