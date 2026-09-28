import { describe, it, expect } from "vitest";
import {
  NUTRITION_SCHEMA_VERSION,
  addNutritionDays,
  nutritionPlanContentSchema,
  type NutritionPlanContent,
  type NutritionSlotId,
  type NutritionValues,
  type TargetVersion,
} from "../../../../shared/nutrition";
import { NutritionPlanError } from "../errors";
import { decidePlanValidation } from "./decide";
import { PRODUCTION_PLAN_VALIDATION_POLICIES, productionPlanValidationPolicyRegistry } from "./registry";
import { TARGET_ALIGNMENT_POLICY_V1 } from "./v1";

/*
  NUT-12C.1: PlanValidationPolicy v1, `target-alignment` v1.

  The target is 2000 kcal, 125 g protein, 240 g carbs and 60 g fat, whose
  macro energy (500 + 960 + 540) is exactly 2000 kcal. Every boundary below
  is a whole-percent multiple of it that is exact in binary, so "at the
  boundary" is exact; "just inside" and "just outside" move by one part in a
  million of the reference — far above rounding, far below any real change.
  Each case moves one check to its edge while every other check stays well
  inside, so the verdict is that check's alone.
*/

const TARGET_VALUES: NutritionValues = { kcal: 2000, proteinG: 125, carbsG: 240, fatG: 60 };
const START = "2026-10-05";
const EPSILON = 1e-6;

const target = (values: NutritionValues = TARGET_VALUES): TargetVersion => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  targetVersionId: "target-1",
  mode: "manual",
  values,
  effectiveFrom: "2026-10-01",
  effectiveOrder: 1,
  policy: { id: "manual-target", version: 1 },
  profileFingerprint: { hash: "a".repeat(64), fields: ["fitnessGoal", "manualTargetKcal", "weight"] },
  supersedesTargetVersionId: null,
  createdAt: { seconds: 0, nanoseconds: 0 },
});

/** A structurally valid week; day `i` totals `days[i]`, split evenly over `slots`. */
const plan = (days: readonly NutritionValues[], slots: NutritionSlotId[] = ["dinner"]): NutritionPlanContent => {
  const content: NutritionPlanContent = {
    startDate: START,
    endDate: addNutritionDays(START, 6),
    slotOrder: slots,
    days: days.map((totals, dayIndex) => ({
      date: addNutritionDays(START, dayIndex),
      meals: slots.map((slotId, slotIndex) => ({
        mealId: `m-${dayIndex}-${slotIndex}`,
        slotId,
        name: `Mahlzeit ${dayIndex} ${slotIndex}`,
        values: {
          kcal: totals.kcal / slots.length,
          proteinG: totals.proteinG / slots.length,
          carbsG: totals.carbsG / slots.length,
          fatG: totals.fatG / slots.length,
        },
      })),
    })),
  };
  expect(nutritionPlanContentSchema.safeParse(content).success).toBe(true);
  return content;
};

/** Six on-target days and `first` as day one. */
const week = (first: NutritionValues) => [first, ...Array.from({ length: 6 }, () => ({ ...TARGET_VALUES }))];

/** Every day the same. */
const everyDay = (day: NutritionValues) => Array.from({ length: 7 }, () => ({ ...day }));

const verdict = (days: readonly NutritionValues[], values: NutritionValues = TARGET_VALUES) =>
  (TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(days), target: target(values) }) as { outcome: string }).outcome;

/** A day scaled to `kcal`, its macros in proportion: every day-level ratio equal. */
const scaledTo = (kcal: number): NutritionValues => {
  const factor = kcal / TARGET_VALUES.kcal;
  return { kcal, proteinG: 125 * factor, carbsG: 240 * factor, fatG: 60 * factor };
};

/* ------------------------------------------------------------------ *
 * Identity and registration
 * ------------------------------------------------------------------ */

describe("provenance", () => {
  it("is target-alignment v1, the one production plan-validation policy", () => {
    expect(TARGET_ALIGNMENT_POLICY_V1.id).toBe("target-alignment");
    expect(TARGET_ALIGNMENT_POLICY_V1.version).toBe(1);
    expect(Object.isFrozen(TARGET_ALIGNMENT_POLICY_V1)).toBe(true);
    expect(PRODUCTION_PLAN_VALIDATION_POLICIES).toEqual([TARGET_ALIGNMENT_POLICY_V1]);
    expect(productionPlanValidationPolicyRegistry.current()).toBe(TARGET_ALIGNMENT_POLICY_V1);
  });

  it("persists only the provenance through the existing seam — no ratio, reason or detail", () => {
    const accepted = decidePlanValidation({
      policy: TARGET_ALIGNMENT_POLICY_V1,
      plan: plan(everyDay(TARGET_VALUES)),
      target: target(),
      reusable: null,
    });
    expect(accepted).toEqual({ policy: { id: "target-alignment", version: 1 }, outcome: "accepted" });
  });

  it("answers the existing rejected verdict, which the seam turns into PLAN_VALIDATION_FAILED", () => {
    const answer = TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(scaledTo(2500))), target: target() });
    expect(answer).toEqual({ outcome: "rejected" });

    let error: unknown;
    try {
      decidePlanValidation({ policy: TARGET_ALIGNMENT_POLICY_V1, plan: plan(everyDay(scaledTo(2500))), target: target(), reusable: null });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NutritionPlanError);
    expect((error as NutritionPlanError).code).toBe("PLAN_VALIDATION_FAILED");
    expect((error as NutritionPlanError).details).toEqual({});
  });

  it("accepts a week exactly on target, and sums a day over its meals", () => {
    expect(verdict(everyDay(TARGET_VALUES))).toBe("accepted");
    const split = TARGET_ALIGNMENT_POLICY_V1.validate({
      plan: plan(everyDay(TARGET_VALUES), ["breakfast", "lunch", "snack_1", "dinner"]),
      target: target(),
    });
    expect(split).toEqual({ outcome: "accepted" });
    // Four meals of a quarter each would be far off target if each were a day.
  });
});

/* ------------------------------------------------------------------ *
 * Daily alignment
 * ------------------------------------------------------------------ */

describe("daily alignment against the TARGET, inclusive", () => {
  const cases = [
    // [label, the edge day's values at the boundary, which way is outside]
    ["kcal at 90 %", scaledTo(1800), "kcal", -1],
    ["kcal at 110 %", scaledTo(2200), "kcal", +1],
    ["protein at 90 %", { ...TARGET_VALUES, proteinG: 112.5 }, "proteinG", -1],
    ["protein at 120 %", { ...TARGET_VALUES, proteinG: 150 }, "proteinG", +1],
    ["fat at 80 %", { ...TARGET_VALUES, fatG: 48 }, "fatG", -1],
    ["fat at 120 %", { ...TARGET_VALUES, fatG: 72 }, "fatG", +1],
    // Lower carbs lower the macro energy; 1900 kcal keeps the day within 10 % of it.
    ["carbs at 80 %", { ...TARGET_VALUES, kcal: 1900, carbsG: 192 }, "carbsG", -1],
    ["carbs at 120 %", { ...TARGET_VALUES, carbsG: 288 }, "carbsG", +1],
  ] as const;

  it.each(cases)("accepts %s", (_label, edge) => {
    expect(verdict(week(edge))).toBe("accepted");
  });

  it.each(cases)("accepts just inside %s", (_label, edge, nutrient, outward) => {
    const inside = { ...edge, [nutrient]: edge[nutrient] - outward * TARGET_VALUES[nutrient] * EPSILON };
    expect(verdict(week(inside))).toBe("accepted");
  });

  it.each(cases)("rejects just outside %s", (_label, edge, nutrient, outward) => {
    const outside = { ...edge, [nutrient]: edge[nutrient] + outward * TARGET_VALUES[nutrient] * EPSILON };
    expect(verdict(week(outside))).toBe("rejected");
  });

  it("checks every day, not only the first", () => {
    const days = everyDay(TARGET_VALUES);
    days[6] = { ...TARGET_VALUES, fatG: 72 + 1 };
    expect(verdict(days)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Seven-day average
 * ------------------------------------------------------------------ */

describe("seven-day average alignment against the TARGET, inclusive", () => {
  // Every day the same, so the average is the day — and each day sits inside
  // its wider daily range and within 10 % of its own macro energy.
  const cases = [
    ["kcal at 95 %", { ...TARGET_VALUES, kcal: 1900 }, "kcal", -1],
    ["kcal at 105 %", { ...TARGET_VALUES, kcal: 2100 }, "kcal", +1],
    ["protein at 95 %", { ...TARGET_VALUES, proteinG: 118.75 }, "proteinG", -1],
    ["protein at 110 %", { ...TARGET_VALUES, proteinG: 137.5 }, "proteinG", +1],
    ["fat at 90 %", { ...TARGET_VALUES, fatG: 54 }, "fatG", -1],
    ["fat at 110 %", { ...TARGET_VALUES, fatG: 66 }, "fatG", +1],
    ["carbs at 90 %", { ...TARGET_VALUES, carbsG: 216 }, "carbsG", -1],
    ["carbs at 110 %", { ...TARGET_VALUES, carbsG: 264 }, "carbsG", +1],
  ] as const;

  it.each(cases)("accepts an average of %s", (_label, day) => {
    expect(verdict(everyDay(day))).toBe("accepted");
  });

  it.each(cases)("accepts an average just inside %s", (_label, day, nutrient, outward) => {
    expect(verdict(everyDay({ ...day, [nutrient]: day[nutrient] - outward * TARGET_VALUES[nutrient] * EPSILON }))).toBe("accepted");
  });

  it.each(cases)("rejects an average just outside %s, though every day passes its daily range", (_label, day, nutrient, outward) => {
    expect(verdict(everyDay({ ...day, [nutrient]: day[nutrient] + outward * TARGET_VALUES[nutrient] * EPSILON }))).toBe("rejected");
  });

  it("averages unequal days over the week", () => {
    // 3 × 2200 + 3 × 2000 + 2100 = 14700 = 7 × 2100: exactly 105 %.
    const days = [2200, 2200, 2200, 2000, 2000, 2000, 2100].map(scaledTo);
    expect(verdict(days)).toBe("accepted");
    days[6] = scaledTo(2100 + 2000 * EPSILON * 7);
    expect(verdict(days)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Reported kcal against macro energy
 * ------------------------------------------------------------------ */

describe("each day's kcal within ±10 % of its macro energy, inclusive", () => {
  // Macro energy 1900 (carbs 215 g): kcal 2090 is 110 % of it, 104.5 % of target.
  const high = { kcal: 2090, proteinG: 125, carbsG: 215, fatG: 60 };
  // Macro energy 2180 (protein 145 g, carbs 265 g): kcal 1962 is 90 % of it, 98.1 % of target.
  const low = { kcal: 1962, proteinG: 145, carbsG: 265, fatG: 60 };

  it("accepts kcal at exactly 110 % and 90 % of the macro energy", () => {
    expect(verdict(week(high))).toBe("accepted");
    expect(verdict(week(low))).toBe("accepted");
  });

  it("accepts kcal just inside either bound", () => {
    expect(verdict(week({ ...high, kcal: 2090 - 1900 * EPSILON }))).toBe("accepted");
    expect(verdict(week({ ...low, kcal: 1962 + 2180 * EPSILON }))).toBe("accepted");
  });

  it("rejects kcal just outside either bound, though it is within the daily kcal range", () => {
    expect(verdict(week({ ...high, kcal: 2090 + 1900 * EPSILON }))).toBe("rejected");
    expect(verdict(week({ ...low, kcal: 1962 - 2180 * EPSILON }))).toBe("rejected");
  });

  it("uses 4 kcal/g for protein and carbs and 9 kcal/g for fat", () => {
    // Same grams, fat weighted as 4 instead of 9 would make 1900 → 1600 and reject.
    expect(verdict(week({ ...high, kcal: 1900 }))).toBe("accepted");
  });
});

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

describe("edges", () => {
  it("a zero target value admits exactly zero, with no division", () => {
    // A manual-target v1 target can carry 0 g carbs when protein and fat use all the energy.
    const zeroCarbs = { kcal: 1200, proteinG: 225, carbsG: 0, fatG: 300 / 9 };
    expect(verdict(everyDay(zeroCarbs), zeroCarbs)).toBe("accepted");
    expect(verdict(week({ ...zeroCarbs, carbsG: 0.1 }), zeroCarbs)).toBe("rejected");
  });

  it("does not touch its input and answers the same every time", () => {
    const input = { plan: plan(week(scaledTo(2100))), target: target() };
    const before = structuredClone(input);
    expect(TARGET_ALIGNMENT_POLICY_V1.validate(input)).toEqual(TARGET_ALIGNMENT_POLICY_V1.validate(input));
    expect(input).toEqual(before);
  });

  it("answers the outcome and nothing else", () => {
    const answers = [
      TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(TARGET_VALUES)), target: target() }),
      TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(scaledTo(3000))), target: target() }),
    ];
    for (const answer of answers) expect(Object.keys(answer as object)).toEqual(["outcome"]);
  });
});

/* ------------------------------------------------------------------ *
 * Roundoff: exact boundaries of decimal values
 * ------------------------------------------------------------------ */

/*
  Regression: `actual·100 >= percent·reference` in plain doubles rejected an
  exact inclusive boundary. 1235.315625 · 90 % is exactly 1111.7840625, yet
  1111.7840625 · 100 evaluates to 111178.40624999999 while 90 · 1235.315625
  is 111178.40625.

  The boundaries below are computed in exact decimal arithmetic (BigInt) and
  only then turned into the nearest double, as a stored value would be. So
  "at the boundary" means the exact decimal boundary, never a product that
  already carries float error.
*/

interface Decimal {
  digits: bigint;
  scale: number;
}

const dec = (text: string): Decimal => {
  const [whole, fraction = ""] = text.split(".");
  return { digits: BigInt(whole + fraction), scale: fraction.length };
};

const rescale = (value: Decimal, scale: number): bigint => value.digits * 10n ** BigInt(scale - value.scale);

const plus = (...values: Decimal[]): Decimal => {
  const scale = Math.max(...values.map((value) => value.scale));
  return { digits: values.reduce((sum, value) => sum + rescale(value, scale), 0n), scale };
};

/** `value · numerator / 10^exponent`, exactly. */
const times = (value: Decimal, numerator: number, exponent = 0): Decimal => ({
  digits: value.digits * BigInt(numerator),
  scale: value.scale + exponent,
});

const percentOf = (value: Decimal, percent: number) => times(value, percent, 2);

/** The double nearest the exact decimal. */
const num = (value: Decimal): number => {
  const text = value.digits.toString().padStart(value.scale + 1, "0");
  return Number(value.scale === 0 ? text : `${text.slice(0, -value.scale)}.${text.slice(-value.scale)}`);
};

type DecimalValues = Record<keyof NutritionValues, Decimal>;

const toValues = (values: DecimalValues): NutritionValues => ({
  kcal: num(values.kcal),
  proteinG: num(values.proteinG),
  carbsG: num(values.carbsG),
  fatG: num(values.fatG),
});

const macroEnergyOf = (values: DecimalValues) => plus(times(values.proteinG, 4), times(values.carbsG, 4), times(values.fatG, 9));

/** The old comparison, kept only to show which boundaries it got wrong. */
const plainWithin = (actual: number, reference: number, min: number, max: number) =>
  actual * 100 >= min * reference && actual * 100 <= max * reference;

/** A decimal TARGET whose macro energy (1235.3143) is within 0.0002 % of its kcal. */
const DECIMAL_TARGET: DecimalValues = {
  kcal: dec("1235.315625"),
  proteinG: dec("77.2071"),
  carbsG: dec("154.4143"),
  fatG: dec("34.3143"),
};
const DECIMAL_TARGET_VALUES = toValues(DECIMAL_TARGET);

/** DECIMAL_TARGET with each nutrient at the given whole percent (100 when not named). */
const atPercent = (percents: Partial<Record<keyof NutritionValues, number>>): DecimalValues => ({
  kcal: percentOf(DECIMAL_TARGET.kcal, percents.kcal ?? 100),
  proteinG: percentOf(DECIMAL_TARGET.proteinG, percents.proteinG ?? 100),
  carbsG: percentOf(DECIMAL_TARGET.carbsG, percents.carbsG ?? 100),
  fatG: percentOf(DECIMAL_TARGET.fatG, percents.fatG ?? 100),
});

const decimalWeek = (first: NutritionValues, rest: NutritionValues = DECIMAL_TARGET_VALUES) => [
  first,
  ...Array.from({ length: 6 }, () => ({ ...rest })),
];

/** One part in a million: the smallest real change the existing tests use. */
const MEANINGFUL = 1e-6;
/** Far below any real change, yet about seventy times the comparison slack. */
const TINY = 1e-12;

const nudge = (values: NutritionValues, nutrient: keyof NutritionValues, relative: number): NutritionValues => ({
  ...values,
  [nutrient]: values[nutrient] * (1 + relative),
});

describe("exact inclusive boundaries survive floating-point roundoff", () => {
  it("accepts the reported day at exactly 90 % of a 1235.315625 kcal target, which plain doubles rejected", () => {
    expect(1111.7840625 * 100 >= 90 * 1235.315625).toBe(false);
    expect(num(percentOf(DECIMAL_TARGET.kcal, 90))).toBe(1111.7840625);

    const day = toValues(atPercent({ kcal: 90, proteinG: 90, carbsG: 90, fatG: 90 }));
    expect(day.kcal).toBe(1111.7840625);
    expect(verdict(decimalWeek(day), DECIMAL_TARGET_VALUES)).toBe("accepted");
  });

  const dailyCases = [
    // [label, the edge day in whole percent of the decimal TARGET, the nutrient at its edge, which way is outside]
    ["kcal at 90 %", { kcal: 90, proteinG: 90, carbsG: 90, fatG: 90 }, "kcal", -1],
    ["kcal at 110 %", { kcal: 110, proteinG: 110, carbsG: 110, fatG: 110 }, "kcal", +1],
    ["protein at 90 %", { proteinG: 90 }, "proteinG", -1],
    ["protein at 120 %", { proteinG: 120 }, "proteinG", +1],
    ["fat at 80 %", { fatG: 80 }, "fatG", -1],
    ["fat at 120 %", { fatG: 120 }, "fatG", +1],
    // Lower carbs lower the macro energy; 95 % kcal keeps the day within 10 % of it.
    ["carbs at 80 %", { kcal: 95, carbsG: 80 }, "carbsG", -1],
    ["carbs at 120 %", { carbsG: 120 }, "carbsG", +1],
  ] as const;

  it.each(dailyCases)("accepts a decimal day exactly at %s", (_label, percents) => {
    expect(verdict(decimalWeek(toValues(atPercent(percents))), DECIMAL_TARGET_VALUES)).toBe("accepted");
  });

  it.each(dailyCases)("still rejects a decimal day a meaningful step outside %s", (_label, percents, nutrient, outward) => {
    const edge = toValues(atPercent(percents));
    expect(verdict(decimalWeek(nudge(edge, nutrient, outward * MEANINGFUL)), DECIMAL_TARGET_VALUES)).toBe("rejected");
  });

  it.each(dailyCases)("rejects a decimal day even 1e-12 outside %s: the slack is machine-sized", (_label, percents, nutrient, outward) => {
    const edge = toValues(atPercent(percents));
    expect(verdict(decimalWeek(nudge(edge, nutrient, outward * TINY)), DECIMAL_TARGET_VALUES)).toBe("rejected");
  });

  const weeklyCases = [
    ["kcal at 95 %", { kcal: 95 }, "kcal", -1],
    ["kcal at 105 %", { kcal: 105 }, "kcal", +1],
    ["protein at 95 %", { proteinG: 95 }, "proteinG", -1],
    ["protein at 110 %", { proteinG: 110 }, "proteinG", +1],
    ["fat at 90 %", { fatG: 90 }, "fatG", -1],
    ["fat at 110 %", { fatG: 110 }, "fatG", +1],
    ["carbs at 90 %", { carbsG: 90 }, "carbsG", -1],
    ["carbs at 110 %", { carbsG: 110 }, "carbsG", +1],
  ] as const;

  it.each(weeklyCases)("accepts a decimal seven-day average exactly at %s", (_label, percents) => {
    expect(verdict(everyDay(toValues(atPercent(percents))), DECIMAL_TARGET_VALUES)).toBe("accepted");
  });

  it.each(weeklyCases)("still rejects a decimal seven-day average a meaningful step outside %s", (_label, percents, nutrient, outward) => {
    const day = toValues(atPercent(percents));
    expect(verdict(everyDay(nudge(day, nutrient, outward * MEANINGFUL)), DECIMAL_TARGET_VALUES)).toBe("rejected");
  });

  it.each(weeklyCases)("rejects a decimal seven-day average even 1e-12 outside %s", (_label, percents, nutrient, outward) => {
    const day = toValues(atPercent(percents));
    expect(verdict(everyDay(nudge(day, nutrient, outward * TINY)), DECIMAL_TARGET_VALUES)).toBe("rejected");
  });

  it("accepts an exact decimal seven-day average made of unequal days", () => {
    // 3 × 110 % + 3 × 100 % + 105 % = 735 % over seven days: exactly 105 %, the upper bound.
    // Each day's macros scale with its kcal, so only the weekly kcal average is at an edge.
    const days = [110, 110, 110, 100, 100, 100, 105].map((percent) =>
      toValues(atPercent({ kcal: percent, proteinG: percent, carbsG: percent, fatG: percent }))
    );
    expect(verdict(days, DECIMAL_TARGET_VALUES)).toBe("accepted");
    days[6] = nudge(days[6], "kcal", MEANINGFUL * 7);
    expect(verdict(days, DECIMAL_TARGET_VALUES)).toBe("rejected");
  });

  describe("a day's kcal against its own decimal macro energy", () => {
    // The day's macros are the decimal TARGET's; their exact energy E is 1235.3143.
    const energy = macroEnergyOf(DECIMAL_TARGET);
    const macros = { proteinG: DECIMAL_TARGET.proteinG, carbsG: DECIMAL_TARGET.carbsG, fatG: DECIMAL_TARGET.fatG };
    // The TARGET kcal sits 5 % toward the edge, so the day's kcal is well inside
    // its daily TARGET range and only the macro-energy bound is at its edge.
    const cases = [
      ["110 %", 110, 105, +1],
      ["90 %", 90, 95, -1],
    ] as const;

    it("has the energy it claims", () => {
      expect(num(energy)).toBe(1235.3143);
    });

    it.each(cases)("accepts kcal exactly at %s of E", (_label, percent, targetPercent) => {
      const target = toValues({ ...macros, kcal: percentOf(energy, targetPercent) });
      const day = toValues({ ...macros, kcal: percentOf(energy, percent) });
      expect(verdict(decimalWeek(day, target), target)).toBe("accepted");
    });

    it.each(cases)("still rejects kcal a meaningful step outside %s of E", (_label, percent, targetPercent, outward) => {
      const target = toValues({ ...macros, kcal: percentOf(energy, targetPercent) });
      const day = nudge(toValues({ ...macros, kcal: percentOf(energy, percent) }), "kcal", outward * MEANINGFUL);
      expect(verdict(decimalWeek(day, target), target)).toBe("rejected");
    });

    it.each(cases)("rejects kcal even 1e-12 outside %s of E", (_label, percent, targetPercent, outward) => {
      const target = toValues({ ...macros, kcal: percentOf(energy, targetPercent) });
      const day = nudge(toValues({ ...macros, kcal: percentOf(energy, percent) }), "kcal", outward * TINY);
      expect(verdict(decimalWeek(day, target), target)).toBe("rejected");
    });
  });

  it("accepts every exact boundary across a sweep of decimal targets, where plain doubles failed", () => {
    let plainFailures = 0;
    for (let index = 0; index < 250; index += 1) {
      // A decimal kcal in the supported range, and macros that carry exactly its
      // energy: protein 25 %, carbs 52.5 %, fat 22.5 % of the kcal.
      const kcal = dec(`${1200 + index * 19}.${String((index * 7919 + 13) % 1_000_000).padStart(6, "0")}`);
      const decimalTarget: DecimalValues = {
        kcal,
        proteinG: times(kcal, 625, 4),
        carbsG: times(kcal, 13125, 5),
        fatG: times(kcal, 25, 3),
      };
      const targetValues = toValues(decimalTarget);
      const scaled = (percent: number): NutritionValues =>
        toValues({
          kcal: percentOf(decimalTarget.kcal, percent),
          proteinG: percentOf(decimalTarget.proteinG, percent),
          carbsG: percentOf(decimalTarget.carbsG, percent),
          fatG: percentOf(decimalTarget.fatG, percent),
        });

      for (const percent of [90, 110]) {
        const day = scaled(percent);
        if (!plainWithin(day.kcal, targetValues.kcal, 90, 110)) plainFailures += 1;
        expect(verdict(decimalWeek(day, targetValues), targetValues), `${num(kcal)} at ${percent} %`).toBe("accepted");
      }
      for (const percent of [95, 105]) {
        expect(verdict(everyDay(scaled(percent)), targetValues), `${num(kcal)} averaging ${percent} %`).toBe("accepted");
      }
    }
    // The sweep is only evidence if the old comparison failed somewhere in it.
    expect(plainFailures).toBeGreaterThan(0);
  });
});

describe("a zero TARGET nutrient is decided exactly, with no slack", () => {
  // A manual-target v1 target can carry 0 g carbs when protein and fat use all the energy.
  const zeroCarbs = { kcal: 1200, proteinG: 225, carbsG: 0, fatG: 300 / 9 };

  it("accepts exactly zero", () => {
    expect(verdict(everyDay(zeroCarbs), zeroCarbs)).toBe("accepted");
  });

  it.each([Number.MIN_VALUE, 1e-300, 1e-12, 1e-6, 0.1])("rejects %s g against a zero target, daily and on average", (carbsG) => {
    expect(verdict(week({ ...zeroCarbs, carbsG }), zeroCarbs)).toBe("rejected");
    expect(verdict(everyDay({ ...zeroCarbs, carbsG }), zeroCarbs)).toBe("rejected");
  });
});
