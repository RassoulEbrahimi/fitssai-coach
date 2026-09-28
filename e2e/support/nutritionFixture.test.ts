import { describe, expect, it } from "vitest";
import {
  addNutritionDays,
  nutritionPlanContentSchema,
  nutritionValuesSchema,
  parseNutritionProfile,
  getNutritionEligibility,
  planOwnsDate,
  resolveNutritionTargetProfileInputs,
  NUTRITION_PLAN_DAY_COUNT,
  type NutritionPlan,
} from "../../shared/nutrition";
import { CALCULATED_TARGET_POLICY_V1 } from "../../functions/src/nutrition/targetPolicy/v1";
import { TARGET_ALIGNMENT_POLICY_V1 } from "../../functions/src/nutrition/planValidation/v1";
import { E2E_DAY_FACTORS, E2E_USERS, buildE2EPlanContent, e2ePlanStartDate } from "./nutritionFixture";

/*
  NUT-13A: the seeded LOCAL test data passes the CURRENT contracts and the
  signed policies. The seed itself gets the target from the real callable and
  activates the plan through the real activation core; this proves the same
  thing without emulators, for every day the seed could run on.
*/

const TODAY = "2026-09-28";

/** What `nutritionSetTarget` computes for a seeded profile: the signed calculated-target v1 policy. */
const targetFor = (profile: Record<string, unknown>) => {
  const inputs = resolveNutritionTargetProfileInputs(parseNutritionProfile(profile), CALCULATED_TARGET_POLICY_V1.requiredProfileFields);
  if (inputs.status !== "complete") throw new Error("seeded profile is incomplete");
  // The policy returns unknown on purpose; the handler parses it, and so does this.
  return nutritionValuesSchema.parse(CALCULATED_TARGET_POLICY_V1.compute({ mode: "calculated", profile: inputs.values }));
};

const populated = Object.values(E2E_USERS).filter((user) => user.nutrition !== null);

describe("E2E accounts", () => {
  it("covers a populated adult, a second populated adult, a missing age and a minor", () => {
    const eligibility = Object.fromEntries(
      Object.values(E2E_USERS).map((user) => [user.key, getNutritionEligibility(parseNutritionProfile(user.profile)).reason])
    );
    expect(eligibility).toEqual({ adult: "eligible", isolation: "eligible", missingAge: "missingAge", minor: "minor" });
    expect(populated.map((user) => user.key)).toEqual(["adult", "isolation"]);
  });

  it("uses reserved .test addresses and distinct, fixed ids", () => {
    const users = Object.values(E2E_USERS);
    expect(users.every((user) => user.email.endsWith("@fitssai-e2e.test"))).toBe(true);
    expect(new Set(users.map((user) => user.uid)).size).toBe(users.length);
    expect(new Set(populated.map((user) => user.nutrition!.targetRequestId)).size).toBe(populated.length);
  });

  it("gives the isolation account no meal name of the adult's plan", () => {
    const names = (key: "adult" | "isolation") => Object.values(E2E_USERS[key].nutrition!.catalog).flat();
    expect(names("adult").filter((name) => names("isolation").includes(name))).toEqual([]);
  });
});

describe.each(populated)("the $key plan", (user) => {
  const target = targetFor(user.profile);

  it.each([TODAY, "2026-12-31", "2027-03-28", "2028-02-29"])("is valid content that target-alignment v1 accepts (seeded on %s)", (today) => {
    const content = buildE2EPlanContent(target, e2ePlanStartDate(today), user.nutrition!.catalog, user.nutrition!.planId);
    expect(nutritionPlanContentSchema.safeParse(content).success).toBe(true);
    expect(TARGET_ALIGNMENT_POLICY_V1.validate({ plan: content, target: { values: target } } as never)).toEqual({ outcome: "accepted" });
  });

  it("covers seven contiguous dates with today in the middle, three meals a day in slot order", () => {
    const content = buildE2EPlanContent(target, e2ePlanStartDate(TODAY), user.nutrition!.catalog, user.nutrition!.planId);
    expect(content.days).toHaveLength(NUTRITION_PLAN_DAY_COUNT);
    expect(content.days.map((day) => day.date)).toEqual(Array.from({ length: 7 }, (_, i) => addNutritionDays("2026-09-25", i)));
    expect(planOwnsDate({ ...content, lifecycle: { status: "active", effectiveUntil: null, supersededByPlanId: null } } as NutritionPlan, TODAY)).toBe(true);
    expect(content.slotOrder).toEqual(["breakfast", "lunch", "dinner"]);
    for (const day of content.days) expect(day.meals.map((meal) => meal.slotId)).toEqual(["breakfast", "lunch", "dinner"]);
    // Every meal of a slot differs from day to day, so a replacement always has other meals to offer.
    for (const slot of ["breakfast", "lunch", "dinner"]) {
      const names = content.days.map((day) => day.meals.find((meal) => meal.slotId === slot)!.name);
      expect(new Set(names).size).toBe(7);
    }
  });

  it("is refused by the policy for a target it was not built for", () => {
    const content = buildE2EPlanContent(target, e2ePlanStartDate(TODAY), user.nutrition!.catalog, user.nutrition!.planId);
    const other = { ...target, kcal: target.kcal * 1.3 };
    expect(TARGET_ALIGNMENT_POLICY_V1.validate({ plan: content, target: { values: other } } as never)).toEqual({ outcome: "rejected" });
  });
});

it("day factors stay inside the daily range and average to exactly the target", () => {
  expect(E2E_DAY_FACTORS).toHaveLength(7);
  expect(E2E_DAY_FACTORS.every((factor) => factor >= 0.95 && factor <= 1.05)).toBe(true);
  expect(E2E_DAY_FACTORS.reduce((sum, factor) => sum + factor, 0)).toBeCloseTo(7, 12);
});
