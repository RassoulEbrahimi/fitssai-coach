import { describe, it, expect } from "vitest";
import {
  NUTRITION_TARGET_PROFILE_FIELDS,
  computeNutritionTargetFingerprint,
  deriveNutritionTargetFreshness,
  isNutritionTargetProfileField,
  nutritionSetTargetRequestSchema,
  nutritionTargetFingerprintMaterial,
  parseNutritionProfile,
  resolveNutritionTargetProfileInputs,
  selectEffectiveTargetVersion,
  type NutritionTargetFingerprintInput,
} from "@shared/nutrition";
import { webSha256Hex } from "@/lib/nutrition/v2/sha256";

/*
  NUT-08: the shared profile fingerprint, target freshness, the target
  request contract and target history. Hashed with Web Crypto here, the
  browser's digest; the Functions suite hashes the same pinned material with
  Node's (functions/src/nutrition/targetBoundary.test.ts).
*/

const PINNED_MATERIAL =
  '["fitssai.nutrition.targetFingerprint",1,"calculated",["pin-policy",3],["biologicalSex","height","weight"],[["biologicalSex","notSpecified"],["height",180],["weight",70.5]]]';
const PINNED_HASH = "d640ab6e8e902feed3eeb9856f075c4bb9eeae8cd0f1d33309b0ed60ef14128a";

const POLICY = { id: "test-fixture-calculated", version: 1 };
const FIELDS = ["weight", "height", "biologicalSex", "activityLevel", "fitnessGoal"] as const;

const PROFILE_DOC = {
  age: 34,
  height: 172.5,
  weight: 68.25,
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  fitnessGoal: "loseFat",
  dietaryPreference: "vegan",
  mealsPerDay: 4,
  fullName: "Alice",
};

const inputFor = (doc: Record<string, unknown>, overrides: Partial<NutritionTargetFingerprintInput> = {}) => {
  const inputs = resolveNutritionTargetProfileInputs(parseNutritionProfile(doc), FIELDS);
  if (inputs.status !== "complete") throw new Error("fixture profile is incomplete");
  return { mode: "calculated" as const, policy: POLICY, fields: inputs.fields, values: inputs.values, ...overrides };
};

const hashOf = async (doc: Record<string, unknown>, overrides: Partial<NutritionTargetFingerprintInput> = {}) =>
  (await computeNutritionTargetFingerprint(inputFor(doc, overrides), webSha256Hex)).hash;

describe("fingerprint hash", () => {
  it("is the platform SHA-256, identical to the server's for the pinned material", async () => {
    const material = nutritionTargetFingerprintMaterial({
      mode: "calculated",
      policy: { id: "pin-policy", version: 3 },
      fields: ["weight", "height", "biologicalSex"],
      values: { weight: 70.5, height: 180, biologicalSex: "notSpecified" },
    });
    expect(material).toBe(PINNED_MATERIAL);
    expect(await webSha256Hex(material)).toBe(PINNED_HASH);
    // SHA-256("abc"), FIPS 180-2 test vector.
    expect(await webSha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("is the same for the same normalised inputs, including another stored goal spelling", async () => {
    expect(await hashOf(PROFILE_DOC)).toBe(await hashOf({ ...PROFILE_DOC }));
    expect(await hashOf({ ...PROFILE_DOC, fitnessGoal: "lose-fat" })).toBe(await hashOf(PROFILE_DOC));
  });

  it("does not depend on property order", async () => {
    const reversed = Object.fromEntries(Object.entries(PROFILE_DOC).reverse());
    const input = inputFor(PROFILE_DOC);
    const reorderedValues = Object.fromEntries(Object.entries(input.values).reverse());
    expect(await hashOf(reversed)).toBe(await hashOf(PROFILE_DOC));
    expect(nutritionTargetFingerprintMaterial({ ...input, values: reorderedValues })).toBe(nutritionTargetFingerprintMaterial(input));
  });

  it("does not depend on the order required fields arrive in", async () => {
    const input = inputFor(PROFILE_DOC);
    const shuffled = { ...input, fields: [...input.fields].reverse() };
    expect(nutritionTargetFingerprintMaterial(shuffled)).toBe(nutritionTargetFingerprintMaterial(input));
    expect((await computeNutritionTargetFingerprint(shuffled, webSha256Hex)).fields).toEqual([
      "activityLevel",
      "biologicalSex",
      "fitnessGoal",
      "height",
      "weight",
    ]);
  });

  it.each([
    ["weight", 68.3],
    ["height", 172],
    ["biologicalSex", "male"],
    ["activityLevel", "veryActive"],
    ["fitnessGoal", "gainMuscle"],
  ])("changes when the relevant %s changes", async (field, value) => {
    expect(await hashOf({ ...PROFILE_DOC, [field]: value })).not.toBe(await hashOf(PROFILE_DOC));
  });

  it("ignores profile fields the policy does not require", async () => {
    expect(
      await hashOf({ ...PROFILE_DOC, age: 60, dietaryPreference: "keto", mealsPerDay: 2, fullName: "B", manualTargetKcal: 1800 })
    ).toBe(await hashOf(PROFILE_DOC));
  });

  it("changes with the policy id, the policy version and the mode", async () => {
    const base = await hashOf(PROFILE_DOC);
    expect(await hashOf(PROFILE_DOC, { policy: { ...POLICY, id: "other-policy" } })).not.toBe(base);
    expect(await hashOf(PROFILE_DOC, { policy: { ...POLICY, version: 2 } })).not.toBe(base);
    expect(await hashOf(PROFILE_DOC, { mode: "manual" })).not.toBe(base);
  });

  it("persists the hash and the field names, never a value", async () => {
    const fingerprint = await computeNutritionTargetFingerprint(inputFor(PROFILE_DOC), webSha256Hex);
    expect(Object.keys(fingerprint).sort()).toEqual(["fields", "hash"]);
    expect(fingerprint.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.fields.every(isNutritionTargetProfileField)).toBe(true);
  });

  it("does not mutate its inputs", async () => {
    const input = inputFor(PROFILE_DOC);
    const frozen = Object.freeze({
      ...input,
      fields: Object.freeze([...input.fields].reverse()),
      values: Object.freeze({ ...input.values }),
      policy: Object.freeze({ ...input.policy }),
    });
    const snapshot = JSON.stringify(frozen);
    await computeNutritionTargetFingerprint(frozen, webSha256Hex);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

describe("resolving required fields", () => {
  it("reads only the closed vocabulary", () => {
    expect(NUTRITION_TARGET_PROFILE_FIELDS).toEqual([
      "age",
      "height",
      "weight",
      "biologicalSex",
      "fitnessGoal",
      "activityLevel",
      "nutritionTargetMode",
      "manualTargetKcal",
    ]);
    for (const field of ["dietaryPreference", "mealsPerDay", "excludedFoodCategories", "email", "__proto__", "age.value"]) {
      expect(isNutritionTargetProfileField(field), field).toBe(false);
    }
  });

  it("reports missing and invalid fields separately, never guessing a value", () => {
    const profile = parseNutritionProfile({ ...PROFILE_DOC, height: undefined, weight: "68", activityLevel: "sehr aktiv" });
    expect(resolveNutritionTargetProfileInputs(profile, FIELDS)).toEqual({
      status: "incomplete",
      missingFields: ["height"],
      invalidFields: ["activityLevel", "weight"],
    });
  });
});

describe("target freshness", () => {
  const targetFor = async (doc: Record<string, unknown>) => ({
    mode: "calculated" as const,
    policy: POLICY,
    profileFingerprint: await computeNutritionTargetFingerprint(inputFor(doc), webSha256Hex),
  });

  it("is fresh while the required answers are unchanged", async () => {
    const target = await targetFor(PROFILE_DOC);
    expect(await deriveNutritionTargetFreshness(target, parseNutritionProfile(PROFILE_DOC), webSha256Hex)).toEqual({
      status: "fresh",
    });
  });

  it("is stale after a relevant change, and fresh again after an irrelevant one", async () => {
    const target = await targetFor(PROFILE_DOC);
    const heavier = parseNutritionProfile({ ...PROFILE_DOC, weight: 72 });
    const renamed = parseNutritionProfile({ ...PROFILE_DOC, fullName: "Other", dietaryPreference: "keto" });

    expect(await deriveNutritionTargetFreshness(target, heavier, webSha256Hex)).toEqual({ status: "stale" });
    expect(await deriveNutritionTargetFreshness(target, renamed, webSha256Hex)).toEqual({ status: "fresh" });
  });

  it("cannot compare when a required field is now missing or invalid", async () => {
    const target = await targetFor(PROFILE_DOC);
    const profile = parseNutritionProfile({ ...PROFILE_DOC, height: null, biologicalSex: "x" });

    expect(await deriveNutritionTargetFreshness(target, profile, webSha256Hex)).toEqual({
      status: "cannotCompare",
      missingFields: ["height"],
      invalidFields: ["biologicalSex"],
      unknownFields: [],
    });
  });

  it("cannot compare a field this build does not know, and never claims fresh", async () => {
    const target = await targetFor(PROFILE_DOC);
    const future = { ...target, profileFingerprint: { ...target.profileFingerprint, fields: ["bodyFatPercent", "height"] } };

    expect(await deriveNutritionTargetFreshness(future, parseNutritionProfile(PROFILE_DOC), webSha256Hex)).toEqual({
      status: "cannotCompare",
      missingFields: [],
      invalidFields: [],
      unknownFields: ["bodyFatPercent"],
    });
  });
});

describe("the set-target request", () => {
  const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

  it("is exactly a mode and a lower-case request id", () => {
    expect(nutritionSetTargetRequestSchema.safeParse({ mode: "calculated", requestId: REQUEST_ID }).success).toBe(true);
    expect(nutritionSetTargetRequestSchema.safeParse({ mode: "manual", requestId: REQUEST_ID }).success).toBe(true);
    expect(nutritionSetTargetRequestSchema.safeParse({ mode: "manual", requestId: REQUEST_ID.toUpperCase() }).success).toBe(false);
    expect(nutritionSetTargetRequestSchema.safeParse({ mode: "auto", requestId: REQUEST_ID }).success).toBe(false);
  });

  it.each(["uid", "profile", "height", "weight", "age", "biologicalSex", "activityLevel", "fitnessGoal", "manualTargetKcal", "values"])(
    "refuses %s in the request",
    (field) => {
      expect(nutritionSetTargetRequestSchema.safeParse({ mode: "manual", requestId: REQUEST_ID, [field]: 1 }).success).toBe(false);
    }
  );
});

describe("the effective target on a date", () => {
  const version = (id: string, effectiveFrom: string, effectiveOrder: number) => ({ id, effectiveFrom, effectiveOrder });
  const history = [
    version("a", "2026-09-01", 1),
    version("c", "2026-09-10", 3),
    version("b", "2026-09-10", 2),
    version("d", "2026-09-20", 4),
  ];

  it("is the latest version that had started, by date then effectiveOrder", () => {
    expect(selectEffectiveTargetVersion(history, "2026-08-31")).toBeNull();
    expect(selectEffectiveTargetVersion(history, "2026-09-01")?.id).toBe("a");
    expect(selectEffectiveTargetVersion(history, "2026-09-09")?.id).toBe("a");
    expect(selectEffectiveTargetVersion(history, "2026-09-10")?.id).toBe("c");
    expect(selectEffectiveTargetVersion(history, "2026-09-19")?.id).toBe("c");
    expect(selectEffectiveTargetVersion(history, "2026-12-31")?.id).toBe("d");
  });

  it("does not depend on the order the versions are listed in", () => {
    expect(selectEffectiveTargetVersion([...history].reverse(), "2026-09-15")?.id).toBe("c");
  });
});
