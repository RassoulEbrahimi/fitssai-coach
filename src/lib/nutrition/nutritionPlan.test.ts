import { describe, it, expect } from "vitest";
import {
  NUTRITION_PLAN_ERROR_CODES,
  NutritionPlanStructureError,
  NutritionPlanTransitionError,
  addNutritionDays,
  assertNutritionPlanContentStructure,
  assertNutritionPlanStructure,
  assertPlanTransition,
  buildRepeatedPlanContent,
  isNutritionPlanErrorCode,
  nutritionPlanSchema,
  nutritionRepeatPlanRequestSchema,
  nutritionRepeatPlanResultSchema,
  planOwnedUntil,
  planOwnsDate,
  repeatedPlanStartDate,
  supersedeNutritionPlan,
  supersededLifecycleFor,
  type NutritionPlan,
  type NutritionPlanLifecycle,
} from "@shared/nutrition";
import { PLAN_END, PLAN_START, deepFrozen, makePlan, makeSlotHead } from "@/test/nutritionV2Fixtures";

/*
  NUT-09: the pure base-plan rules in shared/nutrition/plan.ts. A persisted
  plan changes exactly once — active → superseded, lifecycle only — a date
  belongs to a base plan by calendar dates alone, and a repeat copies the base
  week one week later and nothing else.
*/

const active = (): NutritionPlan => makePlan();

const supersededBy = (planId = "plan-2", effectiveUntil = PLAN_END): NutritionPlanLifecycle => ({
  status: "superseded",
  effectiveUntil,
  supersededByPlanId: planId,
});

const withLifecycle = (plan: NutritionPlan, lifecycle: NutritionPlanLifecycle): NutritionPlan => ({ ...plan, lifecycle });

const violation = (run: () => void) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NutritionPlanTransitionError);
    return error as NutritionPlanTransitionError;
  }
  throw new Error("expected the transition to be refused");
};

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("assertNutritionPlanStructure", () => {
  it("returns the parsed plan and leaves the input as it was", () => {
    const plan = deepFrozen(active());
    expect(assertNutritionPlanStructure(plan)).toEqual(plan);
  });

  it("throws a structure error with the schema's issues", () => {
    const broken = { ...active(), days: active().days.slice(0, 6) };
    expect(() => assertNutritionPlanStructure(broken)).toThrow(NutritionPlanStructureError);
    try {
      assertNutritionPlanStructure(broken);
    } catch (error) {
      expect((error as NutritionPlanStructureError).issues.map((issue) => issue.path.join("."))).toContain("days");
    }
  });

  it("checks base content alone by the same rules, returning a fresh copy", () => {
    const { startDate, endDate, slotOrder, days } = active();
    const content = deepFrozen({ startDate, endDate, slotOrder, days });
    const parsed = assertNutritionPlanContentStructure(content);
    expect(parsed).toEqual(content);
    expect(parsed).not.toBe(content);
    expect(() => assertNutritionPlanContentStructure({ ...content, slotOrder: ["breakfast", "breakfast"] })).toThrow(
      NutritionPlanStructureError
    );
  });
});

/* ------------------------------------------------------------------ *
 * assertPlanTransition
 * ------------------------------------------------------------------ */

describe("assertPlanTransition", () => {
  it("1. allows active → superseded, changing only the lifecycle", () => {
    const before = active();
    expect(() => assertPlanTransition(before, withLifecycle(before, supersededBy()))).not.toThrow();
    expect(() => assertPlanTransition(before, withLifecycle(before, supersededBy("plan-2", PLAN_START)))).not.toThrow();
  });

  it("compares content, not key order", () => {
    const before = active();
    const { lifecycle: _lifecycle, ...rest } = before;
    const reordered = Object.fromEntries(Object.entries({ ...rest, lifecycle: supersededBy() }).reverse());
    expect(() => assertPlanTransition(before, reordered)).not.toThrow();
  });

  const changed = (mutate: (plan: NutritionPlan) => NutritionPlan) => {
    const before = active();
    return violation(() => assertPlanTransition(before, mutate(withLifecycle(before, supersededBy()))));
  };

  it("2. rejects a content change (meals swapped between days)", () => {
    const error = changed((plan) => {
      const days = structuredClone(plan.days);
      [days[0].meals, days[1].meals] = [days[1].meals, days[0].meals];
      return { ...plan, days: days.map((day, index) => ({ ...day, date: plan.days[index].date })) };
    });
    expect(error.violation).toBe("immutableFieldChanged");
    expect(error.field).toBe("days");
  });

  it("3. rejects a startDate change", () => {
    const error = changed((plan) => ({ ...makePlan({ startDate: "2026-09-24" }), lifecycle: supersededBy("plan-2", "2026-09-30") }));
    expect(error.field).toBe("startDate");
  });

  it("4. rejects an endDate change", () => {
    // An endDate cannot change alone without breaking the 7-day structure.
    const error = changed((plan) => ({ ...plan, endDate: addNutritionDays(plan.endDate, 1) }));
    expect(error.violation).toBe("malformed");
  });

  it("5. rejects a slotOrder change", () => {
    expect(changed((plan) => ({ ...plan, slotOrder: [...plan.slotOrder].reverse() })).field).toBe("slotOrder");
  });

  it("6. rejects a meal name change", () => {
    const error = changed((plan) => {
      const days = structuredClone(plan.days);
      days[4].meals[0].name = "Renamed";
      return { ...plan, days };
    });
    expect(error.field).toBe("days");
  });

  it("6b. rejects a meal id change", () => {
    const error = changed((plan) => {
      const days = structuredClone(plan.days);
      days[2].meals[1].mealId = "m-other";
      return { ...plan, days };
    });
    expect(error.field).toBe("days");
  });

  it.each(["kcal", "proteinG", "carbsG", "fatG"] as const)("7. rejects a NutritionValues change (%s)", (key) => {
    const error = changed((plan) => {
      const days = structuredClone(plan.days);
      days[6].meals[2].values[key] += 0.001;
      return { ...plan, days };
    });
    expect(error.field).toBe("days");
  });

  it("8. rejects a targetVersionId change", () => {
    expect(changed((plan) => ({ ...plan, targetVersionId: "target-2" })).field).toBe("targetVersionId");
  });

  it("9. rejects a source change", () => {
    const error = changed((plan) => ({ ...plan, source: "repeated", repeatedFromPlanId: "plan-0" }));
    expect(error.field).toBe("source");
  });

  it("9b. rejects a repeatedFromPlanId or generationRequestId change", () => {
    expect(changed((plan) => ({ ...plan, generationRequestId: "gen-1" })).field).toBe("generationRequestId");
    const repeated = { ...active(), source: "repeated" as const, repeatedFromPlanId: "plan-0" };
    const error = violation(() =>
      assertPlanTransition(repeated, { ...repeated, repeatedFromPlanId: "plan-9", lifecycle: supersededBy() })
    );
    expect(error.field).toBe("repeatedFromPlanId");
  });

  it("10. rejects a validation provenance change", () => {
    const error = changed((plan) => ({ ...plan, validation: { policy: { id: "test-fixture-accept", version: 2 }, outcome: "accepted" } }));
    expect(error.field).toBe("validation");
  });

  it("11. rejects a createdAt change", () => {
    expect(changed((plan) => ({ ...plan, createdAt: { seconds: 1_789_999_999, nanoseconds: 0 } })).field).toBe("createdAt");
  });

  it("12. rejects an activatedAt change", () => {
    expect(changed((plan) => ({ ...plan, activatedAt: { seconds: 1_790_000_001, nanoseconds: 0 } })).field).toBe("activatedAt");
  });

  it("13. rejects active → active, edited or not", () => {
    const before = active();
    expect(violation(() => assertPlanTransition(before, before)).violation).toBe("notSuperseded");
    const edited = { ...before, days: structuredClone(before.days) };
    edited.days[0].meals[0].name = "Edited while active";
    expect(violation(() => assertPlanTransition(before, edited)).violation).toBe("notSuperseded");
  });

  it("14. rejects superseded → active", () => {
    const superseded = withLifecycle(active(), supersededBy());
    expect(violation(() => assertPlanTransition(superseded, active())).violation).toBe("notActive");
  });

  it("15. rejects any second transition of a superseded plan, even an identical one", () => {
    const superseded = withLifecycle(active(), supersededBy());
    expect(violation(() => assertPlanTransition(superseded, superseded)).violation).toBe("notActive");
  });

  it("16. rejects a later supersededByPlanId change", () => {
    const superseded = withLifecycle(active(), supersededBy("plan-2"));
    expect(violation(() => assertPlanTransition(superseded, withLifecycle(active(), supersededBy("plan-3")))).violation).toBe(
      "notActive"
    );
  });

  it("17. rejects a later effectiveUntil change", () => {
    const superseded = withLifecycle(active(), supersededBy("plan-2", PLAN_END));
    expect(
      violation(() => assertPlanTransition(superseded, withLifecycle(active(), supersededBy("plan-2", "2026-09-25")))).violation
    ).toBe("notActive");
  });

  it("rejects a malformed side and an extra field", () => {
    const before = active();
    expect(violation(() => assertPlanTransition({ ...before, lifecycle: undefined }, before)).violation).toBe("malformed");
    expect(
      violation(() => assertPlanTransition(before, { ...before, lifecycle: supersededBy(), actualCalories: 1 })).violation
    ).toBe("malformed");
    // A superseded lifecycle outside the plan's own dates is not structural.
    expect(violation(() => assertPlanTransition(before, withLifecycle(before, supersededBy("plan-2", "2026-09-22")))).violation).toBe(
      "malformed"
    );
  });

  it("18. never mutates its inputs", () => {
    const before = deepFrozen(active());
    const after = deepFrozen(withLifecycle(active(), supersededBy()));
    expect(() => assertPlanTransition(before, after)).not.toThrow();
    expect(() => assertPlanTransition(after, before)).toThrow(NutritionPlanTransitionError);
    expect(before).toEqual(active());
  });
});

/* ------------------------------------------------------------------ *
 * Superseding
 * ------------------------------------------------------------------ */

describe("supersedeNutritionPlan", () => {
  it("keeps the whole week for a successor that starts after it", () => {
    expect(supersededLifecycleFor(active(), { planId: "plan-2", startDate: addNutritionDays(PLAN_END, 1) })).toEqual(
      supersededBy("plan-2", PLAN_END)
    );
    // A gap leaves the old plan its own end, never more.
    expect(supersededLifecycleFor(active(), { planId: "plan-2", startDate: "2026-10-15" })).toEqual(supersededBy("plan-2", PLAN_END));
  });

  it("keeps the old plan through the day before a successor that starts inside its week", () => {
    expect(supersededLifecycleFor(active(), { planId: "plan-2", startDate: "2026-09-27" })).toEqual(
      supersededBy("plan-2", "2026-09-26")
    );
    expect(supersededLifecycleFor(active(), { planId: "plan-2", startDate: "2026-09-24" })).toEqual(
      supersededBy("plan-2", PLAN_START)
    );
  });

  it("refuses a successor that would leave it no date, itself, or an already superseded plan", () => {
    expect(() => supersededLifecycleFor(active(), { planId: "plan-2", startDate: PLAN_START })).toThrow(NutritionPlanTransitionError);
    expect(() => supersededLifecycleFor(active(), { planId: "plan-2", startDate: "2026-09-01" })).toThrow(NutritionPlanTransitionError);
    expect(() => supersededLifecycleFor(active(), { planId: "plan-1", startDate: "2026-10-01" })).toThrow(NutritionPlanTransitionError);
    expect(() =>
      supersededLifecycleFor(withLifecycle(active(), supersededBy()), { planId: "plan-3", startDate: "2026-10-01" })
    ).toThrow(NutritionPlanTransitionError);
    expect(() => supersededLifecycleFor(active(), { planId: "plan-2", startDate: "Monday" })).toThrow(RangeError);
  });

  it("returns a new plan with only the lifecycle changed, and leaves the old one as it was", () => {
    const before = deepFrozen(active());
    const after = supersedeNutritionPlan(before, { planId: "plan-2", startDate: "2026-09-30" });
    expect(after).not.toBe(before);
    expect(after).toEqual({ ...active(), lifecycle: supersededBy("plan-2", PLAN_END) });
    expect(before.lifecycle).toEqual({ status: "active", effectiveUntil: null, supersededByPlanId: null });
    expect(nutritionPlanSchema.safeParse(after).success).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

describe("planOwnsDate", () => {
  const dates = Array.from({ length: 7 }, (_, index) => addNutritionDays(PLAN_START, index));

  it("an active plan owns every date from startDate to endDate", () => {
    for (const date of dates) expect(planOwnsDate(active(), date), date).toBe(true);
    expect(planOwnedUntil(active())).toBe(PLAN_END);
  });

  it("an active plan owns nothing outside its dates", () => {
    for (const date of ["2026-09-22", "2026-09-30", "2025-09-23", "2027-09-29"]) {
      expect(planOwnsDate(active(), date), date).toBe(false);
    }
  });

  it("a superseded plan owns only through effectiveUntil", () => {
    const superseded = withLifecycle(active(), supersededBy("plan-2", "2026-09-25"));
    expect(dates.map((date) => planOwnsDate(superseded, date))).toEqual([true, true, true, false, false, false, false]);
    expect(planOwnedUntil(superseded)).toBe("2026-09-25");
    expect(dates.map((date) => planOwnsDate(withLifecycle(active(), supersededBy("plan-2", PLAN_START)), date))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("does not look at meals, slot heads, overrides or entries — dates and lifecycle only", () => {
    const plan = active();
    const override = makeSlotHead("2026-09-26", "lunch");
    const datesOnly = { startDate: plan.startDate, endDate: plan.endDate, lifecycle: plan.lifecycle };
    for (const date of [...dates, "2026-09-22", "2026-09-30"]) {
      expect(planOwnsDate(datesOnly, date)).toBe(planOwnsDate(plan, date));
    }
    // A date with an override is owned exactly as before.
    expect(override.selection.kind).toBe("override");
    expect(planOwnsDate(plan, override.date)).toBe(true);
    expect(planOwnsDate({ ...plan, days: [] } as unknown as NutritionPlan, override.date)).toBe(true);
  });

  it("uses calendar dates only: the weekday a plan starts on is irrelevant", () => {
    // Wednesday, Sunday (the fall-back DST Sunday) and Monday starts behave alike.
    for (const startDate of ["2026-09-23", "2026-10-25", "2026-10-26"]) {
      const plan = makePlan({ startDate });
      const own = Array.from({ length: 9 }, (_, index) => planOwnsDate(plan, addNutritionDays(startDate, index - 1)));
      expect(own, startDate).toEqual([false, true, true, true, true, true, true, true, false]);
    }
  });

  it("refuses anything but a Berlin ISO calendar date", () => {
    for (const bad of ["Monday", "Mo", "2026-9-24", "24.09.2026", "2026-09-31", "2026-09-24T10:00:00Z"]) {
      expect(() => planOwnsDate(active(), bad), bad).toThrow(RangeError);
    }
    expect(() => planOwnsDate(active(), new Date("2026-09-24") as unknown as string)).toThrow(RangeError);
  });

  it("never mutates the plan", () => {
    const plan = deepFrozen(withLifecycle(active(), supersededBy()));
    expect(() => dates.forEach((date) => planOwnsDate(plan, date))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Repeat content
 * ------------------------------------------------------------------ */

describe("buildRepeatedPlanContent", () => {
  it("is the base week one week later: shifted contiguous dates, same slots, same meals", () => {
    const source = active();
    const repeated = buildRepeatedPlanContent(source);

    expect(repeatedPlanStartDate(source)).toBe("2026-09-30");
    expect(repeated.startDate).toBe("2026-09-30");
    expect(repeated.endDate).toBe("2026-10-06");
    expect(repeated.days.map((day) => day.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addNutritionDays("2026-09-30", index))
    );
    expect(repeated.slotOrder).toEqual(source.slotOrder);
    // Day i maps to day i: the same meal ids, names and values, in the same order.
    expect(repeated.days.map((day) => day.meals)).toEqual(source.days.map((day) => day.meals));
    expect(assertNutritionPlanContentStructure(repeated)).toEqual(repeated);
  });

  it("keeps meal ids: unique within the plan, and a reference carries its plan id", () => {
    const repeated = buildRepeatedPlanContent(active());
    const ids = repeated.days.flatMap((day) => day.meals.map((meal) => meal.mealId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(active().days.flatMap((day) => day.meals.map((meal) => meal.mealId)));
  });

  it("is deterministic, shares nothing with the source and leaves it unchanged", () => {
    const source = deepFrozen(active());
    const first = buildRepeatedPlanContent(source);
    const second = buildRepeatedPlanContent(source);
    expect(first).toEqual(second);

    first.days[0].meals[0].values.kcal = 1;
    first.slotOrder.push("snack_2");
    expect(source).toEqual(active());
    expect(second.days[0].meals[0].values.kcal).toBe(active().days[0].meals[0].values.kcal);
  });

  it("copies base meals field by field, and nothing else a plan might carry", () => {
    const source = active();
    const polluted = {
      ...source,
      lifecycle: supersededBy(),
      slotHeads: [makeSlotHead("2026-09-24", "lunch")],
      days: source.days.map((day) => ({
        ...day,
        override: { name: "Override" },
        meals: day.meals.map((meal) => ({ ...meal, recorded: true, values: { ...meal.values, fiberG: 3 } })),
      })),
    };
    const repeated = buildRepeatedPlanContent(polluted);
    expect(Object.keys(repeated).sort()).toEqual(["days", "endDate", "slotOrder", "startDate"]);
    expect(JSON.stringify(repeated)).not.toMatch(/override|Override|recorded|fiberG|slotHeads|lifecycle|superseded/);
    expect(repeated).toEqual(buildRepeatedPlanContent(source));
  });

  it("crosses a year and a DST switch by calendar days", () => {
    expect(buildRepeatedPlanContent(makePlan({ startDate: "2026-12-24" }))).toMatchObject({
      startDate: "2026-12-31",
      endDate: "2027-01-06",
    });
    const dst = buildRepeatedPlanContent(makePlan({ startDate: "2026-10-18" }));
    expect(dst.days.map((day) => day.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
  });

  it("refuses a source that is not a whole week", () => {
    const source = active();
    expect(() => buildRepeatedPlanContent({ ...source, days: source.days.slice(0, 6) })).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ *
 * The repeat callable contract
 * ------------------------------------------------------------------ */

describe("the nutritionRepeatPlan contract", () => {
  const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

  it("accepts exactly { requestId } with a lower-case UUID", () => {
    expect(nutritionRepeatPlanRequestSchema.parse({ requestId: REQUEST_ID })).toEqual({ requestId: REQUEST_ID });
    for (const bad of [
      {},
      { requestId: REQUEST_ID.toUpperCase() },
      { requestId: "abc" },
      { requestId: REQUEST_ID, uid: "bob" },
      { requestId: REQUEST_ID, planId: "plan-1" },
      { requestId: REQUEST_ID, targetVersionId: "tv-1" },
      { requestId: REQUEST_ID, startDate: "2026-10-01" },
      { requestId: REQUEST_ID, days: [] },
      { requestId: REQUEST_ID, slotHeads: [] },
    ]) {
      expect(nutritionRepeatPlanRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("answers a plan id and whether it was a replay", () => {
    expect(nutritionRepeatPlanResultSchema.safeParse({ ok: true, planId: "plan-2", replay: false }).success).toBe(true);
    expect(nutritionRepeatPlanResultSchema.safeParse({ ok: true, planId: "../x", replay: false }).success).toBe(false);
    expect(nutritionRepeatPlanResultSchema.safeParse({ ok: true, planId: "plan-2" }).success).toBe(false);
  });

  it("has stable error codes", () => {
    expect(NUTRITION_PLAN_ERROR_CODES).toEqual([
      "UNAUTHENTICATED",
      "INVALID_REQUEST",
      "NOT_ELIGIBLE",
      "NO_CURRENT_TARGET",
      "NO_ACTIVE_PLAN",
      "PLAN_NOT_ACTIVE",
      "TARGET_CHANGED",
      "PLAN_NOT_REPEATABLE",
      "PLAN_VALIDATION_POLICY_NOT_CONFIGURED",
      "PLAN_VALIDATION_FAILED",
      "STALE_ACTIVE_PLAN",
      "STALE_TARGET",
      "INTERNAL",
    ]);
    expect(isNutritionPlanErrorCode("TARGET_CHANGED")).toBe(true);
    expect(isNutritionPlanErrorCode("users/alice: boom")).toBe(false);
  });
});
