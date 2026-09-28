import { describe, it, expect } from "vitest";
import { NUTRITION_SLOT_IDS, parseNutritionProfile, type NutritionSlotId } from "../../../shared/nutrition";
import {
  buildNutritionGenerationInput,
  computeNutritionGenerationFingerprint,
  nutritionGenerationInputMaterial,
  nutritionGenerationInputSchema,
  productionInitialSlotConfiguration,
  type NutritionGenerationInput,
} from "./generationInput";
import { nodeSha256Hex } from "./sha256";

/*
  NUT-11: what a generator is told, and the fingerprint the request keeps
  instead of it.

  The input carries derived TARGET values, the week's dates and slots, and the
  signed-off dietary preference — never an account, a person or their raw
  answers. Food exclusions are not part of the signed profile contract, so a
  stored exclusion field of any shape never reaches the input.
*/

/** A stored profile with everything a profile document can carry, and more. */
const RAW_PROFILE = {
  uid: "alice-uid-marker",
  fullName: "Alice Beispiel",
  email: "alice@example.com",
  age: 34,
  dateOfBirth: "1992-01-02",
  height: 172.5,
  weight: 68.25,
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  fitnessGoal: "loseWeight",
  nutritionTargetMode: "manual",
  manualTargetKcal: 1777,
  dietaryPreference: "vegetarian",
  mealsPerDay: 3,
  excludedFoodCategories: ["raw-exclusion-marker"],
  excludedFoods: ["another-exclusion-marker"],
};

const TARGET = { values: { kcal: 1800.5, proteinG: 120, carbsG: 200.25, fatG: 60 } };
const SLOTS: NutritionSlotId[] = ["breakfast", "lunch", "dinner"];

const build = (overrides: Partial<Parameters<typeof buildNutritionGenerationInput>[0]> = {}) =>
  buildNutritionGenerationInput({
    startDate: "2026-09-29",
    target: TARGET,
    slotOrder: SLOTS,
    profile: parseNutritionProfile(RAW_PROFILE),
    ...overrides,
  });

const fingerprint = (input: NutritionGenerationInput) => computeNutritionGenerationFingerprint(input, nodeSha256Hex);

describe("the minimized generation input", () => {
  it("is exactly the start, the length, the TARGET, the slots and the dietary preference", () => {
    expect(build()).toEqual({
      startDate: "2026-09-29",
      dayCount: 7,
      target: { kcal: 1800.5, proteinG: 120, carbsG: 200.25, fatG: 60 },
      slotOrder: ["breakfast", "lunch", "dinner"],
      dietaryPreference: "vegetarian",
    });
    expect(nutritionGenerationInputSchema.safeParse(build()).success).toBe(true);
  });

  it.each([
    "uid",
    "name",
    "email",
    "age",
    "dateOfBirth",
    "height",
    "weight",
    "biologicalSex",
    "activityLevel",
    "fitnessGoal",
    "manualTargetKcal",
    "nutritionTargetMode",
    "profile",
    "path",
    "excluded",
  ])("carries no %s field", (field) => {
    const keys = JSON.stringify(build()).match(/"(\w+)":/g) ?? [];
    expect(keys.map((key) => key.slice(1, -2).toLowerCase())).not.toContain(field.toLowerCase());
    expect(JSON.stringify(build()).toLowerCase()).not.toContain(`"${field.toLowerCase()}`);
  });

  it("carries no raw profile value, no account id and no Firestore path", () => {
    const text = JSON.stringify(build());
    for (const leak of ["alice", "Beispiel", "example.com", "1992", "172.5", "68.25", "female", "moderatelyActive", "loseWeight", "manual", "1777", "users/", "nutrition_v2_"]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(text).not.toMatch(/\b34\b/);
  });

  it("never passes a stored exclusion field to the provider: exclusions are not signed off", () => {
    const text = JSON.stringify(build());
    expect(text).not.toMatch(/exclusion-marker|exclu/i);
    // The profile contract itself does not read them.
    expect(Object.keys(parseNutritionProfile(RAW_PROFILE))).not.toContain("excludedFoodCategories");
  });

  it("reads the dietary preference only as a signed-off answer: missing or unknown is null", () => {
    expect(build({ profile: parseNutritionProfile({ ...RAW_PROFILE, dietaryPreference: undefined }) }).dietaryPreference).toBeNull();
    expect(build({ profile: parseNutritionProfile({ ...RAW_PROFILE, dietaryPreference: "paleo" }) }).dietaryPreference).toBeNull();
    expect(build({ profile: parseNutritionProfile({ ...RAW_PROFILE, dietaryPreference: "noPreference" }) }).dietaryPreference).toBe("noPreference");
  });

  it("puts slots in canonical day order and refuses a duplicate", () => {
    expect(build({ slotOrder: ["dinner", "breakfast", "snack_2", "lunch"] }).slotOrder).toEqual(["breakfast", "lunch", "dinner", "snack_2"]);
    expect(() => build({ slotOrder: ["lunch", "lunch"] })).toThrow();
    expect(() => build({ slotOrder: [] })).toThrow();
  });

  it("refuses a target that is not four finite, non-negative values", () => {
    expect(() => build({ target: { values: { kcal: -1, proteinG: 1, carbsG: 1, fatG: 1 } } })).toThrow();
    expect(() => build({ target: { values: { kcal: Number.NaN, proteinG: 1, carbsG: 1, fatG: 1 } } })).toThrow();
  });

  it("is a fresh, frozen value", () => {
    const input = build();
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.target)).toBe(true);
    expect(Object.isFrozen(input.slotOrder)).toBe(true);
    expect(input.target).not.toBe(TARGET.values);
  });
});

describe("the payload fingerprint", () => {
  const PINNED_MATERIAL =
    '["fitssai.nutrition.generationInput",1,"2026-09-29",7,[1800.5,120,200.25,60],["breakfast","lunch","dinner"],"vegetarian"]';
  // Cross-checked with `sha256sum`.
  const PINNED_HASH = "52e01e9f2520c2af57185663615630ec5e75c803a8dd62b09a71774588bce43b";

  it("is SHA-256 of the pinned canonical material", async () => {
    expect(nutritionGenerationInputMaterial(build())).toBe(PINNED_MATERIAL);
    expect(await fingerprint(build())).toBe(PINNED_HASH);
  });

  it("is the same for the same input, whatever the key or slot order", async () => {
    const reordered = {
      dietaryPreference: "vegetarian",
      slotOrder: ["dinner", "lunch", "breakfast"],
      target: { fatG: 60, carbsG: 200.25, proteinG: 120, kcal: 1800.5 },
      dayCount: 7,
      startDate: "2026-09-29",
    } as unknown as NutritionGenerationInput;
    expect(await fingerprint(reordered)).toBe(PINNED_HASH);
    expect(await fingerprint(build({ slotOrder: ["dinner", "lunch", "breakfast"] }))).toBe(PINNED_HASH);
  });

  it.each([
    ["the start date", { startDate: "2026-09-30" }],
    ["kcal", { target: { values: { ...TARGET.values, kcal: 1800.25 } } }],
    ["protein", { target: { values: { ...TARGET.values, proteinG: 121 } } }],
    ["carbs", { target: { values: { ...TARGET.values, carbsG: 200 } } }],
    ["fat", { target: { values: { ...TARGET.values, fatG: 61 } } }],
    ["the slots", { slotOrder: ["breakfast", "lunch", "dinner", "snack_1"] as NutritionSlotId[] }],
    ["the dietary preference", { profile: parseNutritionProfile({ ...RAW_PROFILE, dietaryPreference: "vegan" }) }],
  ])("changes with %s", async (_label, change) => {
    expect(await fingerprint(build(change))).not.toBe(PINNED_HASH);
  });

  it("does not change with a profile field generation does not read", async () => {
    const other = parseNutritionProfile({ ...RAW_PROFILE, weight: 90, age: 50, email: "other@example.com", excludedFoodCategories: ["x"] });
    expect(await fingerprint(build({ profile: other }))).toBe(PINNED_HASH);
  });

  it("is a lower-case hex digest, and the material is never what is stored", async () => {
    const hash = await fingerprint(build());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("vegetarian");
  });
});

describe("first-plan slots (initial slot mapping v1)", () => {
  it.each([
    [1, ["dinner"]],
    [2, ["breakfast", "dinner"]],
    [3, ["breakfast", "lunch", "dinner"]],
    [4, ["breakfast", "lunch", "snack_1", "dinner"]],
    [5, ["breakfast", "lunch", "snack_1", "dinner", "snack_2"]],
  ] as const)("maps %s meal(s) a day to exactly %j", (meals, slots) => {
    const mapped = productionInitialSlotConfiguration.slotsFor(meals);
    expect(mapped).toEqual(slots);
    expect(Object.isFrozen(mapped)).toBe(true);
    // In canonical day order, from the unchanged canonical vocabulary.
    expect(NUTRITION_SLOT_IDS.filter((slotId) => mapped?.includes(slotId))).toEqual(slots);
  });

  it.each([null, undefined, 0, -1, 6, 7, 2.5, 3.0000001, Number.NaN, Number.POSITIVE_INFINITY, "3", "three", [3], {}])(
    "has no mapping for %p — no count is assumed",
    (meals) => {
      expect(productionInitialSlotConfiguration.slotsFor(meals as number | null)).toBeNull();
    }
  );

  it("does not answer for inherited keys", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      expect(productionInitialSlotConfiguration.slotsFor(key as unknown as number)).toBeNull();
    }
  });

  it("is frozen, and a caller cannot change the mapping through a result", () => {
    expect(Object.isFrozen(productionInitialSlotConfiguration)).toBe(true);
    const three = productionInitialSlotConfiguration.slotsFor(3) as NutritionSlotId[];
    expect(() => three.push("snack_2")).toThrow();
    expect(productionInitialSlotConfiguration.slotsFor(3)).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("builds a valid generation input from each mapping", () => {
    for (const meals of [1, 2, 3, 4, 5]) {
      const slotOrder = productionInitialSlotConfiguration.slotsFor(meals) ?? [];
      expect(build({ slotOrder }).slotOrder).toEqual(slotOrder);
    }
  });
});
