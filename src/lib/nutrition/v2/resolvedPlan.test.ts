import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  nutritionDateAt,
  nutritionPlanSchema,
  recordedEntrySchema,
  slotHeadSchema,
  type RecordedEntry,
} from "@shared/nutrition";
import {
  buildNutritionWeek,
  nutritionRecordingCoverage,
  resolveNutritionDay,
  sumPlannedValues,
} from "./resolvedPlan";
import { deriveNutritionV2TodayView, type NutritionV2TodayInputs } from "./todayView";
import {
  PLAN_END,
  PLAN_ID,
  PLAN_START,
  aiOverride,
  deepFrozen,
  extraEntry,
  makePlan,
  makeSlotHead,
  makeState,
  mealIdFor,
  plannedMealEntry,
  skipEntry,
  values,
} from "@/test/nutritionV2Fixtures";

/*
  NUT-05. The PLANNED read model is derived from a plan, its slot heads and a
  date. It never edits the plan, never turns an override into a base meal and
  never mixes recorded estimates into planned values. Recording coverage is a
  separate, structural answer from explicit slot entries only.
*/

const plan = makePlan();
const DAY = "2026-09-25"; // plan day index 2

describe("fixtures", () => {
  it("are valid NUT-01 documents", () => {
    expect(nutritionPlanSchema.safeParse(plan).success).toBe(true);
    expect(nutritionPlanSchema.safeParse(makePlan({ slotOrder: ["dinner", "breakfast", "snack_2"] })).success).toBe(true);
    expect(slotHeadSchema.safeParse(makeSlotHead(DAY, "lunch")).success).toBe(true);
    for (const entry of [plannedMealEntry(DAY, "lunch"), skipEntry(DAY, "lunch"), extraEntry(DAY)]) {
      expect(recordedEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("resolveNutritionDay", () => {
  it("1. resolves an explicit base selection to the base meal", () => {
    const day = resolveNutritionDay(plan, [makeSlotHead(DAY, "lunch", null)], DAY);

    expect(day?.meals[1]).toEqual({
      source: "base",
      planId: PLAN_ID,
      date: DAY,
      slotId: "lunch",
      mealId: mealIdFor(2, "lunch"),
      name: "lunch 2",
      values: values(702.2, 40, 80, 20),
    });
  });

  it("2. resolves a slot without a head to the base meal", () => {
    const day = resolveNutritionDay(plan, [], DAY);

    expect(day?.meals.map((meal) => [meal.source, meal.source === "base" && meal.mealId])).toEqual([
      ["base", mealIdFor(2, "breakfast")],
      ["base", mealIdFor(2, "lunch")],
      ["base", mealIdFor(2, "dinner")],
    ]);
  });

  it("3. applies an override to exactly its date and slot", () => {
    const override = aiOverride("Linsen-Curry", 900);
    const heads = [makeSlotHead(DAY, "lunch", override)];

    const day = resolveNutritionDay(plan, heads, DAY);
    expect(day?.meals[1]).toEqual({
      source: "override",
      planId: PLAN_ID,
      date: DAY,
      slotId: "lunch",
      name: "Linsen-Curry",
      values: override.meal.values,
      override,
    });
    // No invented V2 meal id for an override.
    expect(day?.meals[1]).not.toHaveProperty("mealId");
    // Same date, other slots: base.
    expect(day?.meals[0].source).toBe("base");
    expect(day?.meals[2].source).toBe("base");
    // Same slot, other dates: base.
    for (const other of plan.days.filter((d) => d.date !== DAY)) {
      expect(resolveNutritionDay(plan, heads, other.date)?.meals[1].source).toBe("base");
    }
  });

  it("4. never mutates the plan or the heads", () => {
    const frozenPlan = deepFrozen(plan);
    const heads = deepFrozen([makeSlotHead(DAY, "lunch"), makeSlotHead(DAY, "dinner", null)]);
    const before = JSON.stringify({ frozenPlan, heads });

    const day = resolveNutritionDay(frozenPlan, heads, DAY);
    buildNutritionWeek({ plan: frozenPlan, slotHeads: heads, entries: [], today: DAY });

    expect(JSON.stringify({ frozenPlan, heads })).toBe(before);
    // The override did not become the plan's base meal.
    const baseLunch = frozenPlan.days[2].meals.find((meal) => meal.slotId === "lunch");
    expect(baseLunch?.name).toBe("lunch 2");
    // Resolved values are copies, not the plan's objects.
    expect(day?.meals[0].values).not.toBe(frozenPlan.days[2].meals.find((m) => m.slotId === "breakfast")?.values);
  });

  it("5. orders meals by plan.slotOrder, not by storage order", () => {
    const reordered = makePlan({ slotOrder: ["dinner", "snack_2", "breakfast"] });

    expect(resolveNutritionDay(reordered, [], DAY)?.meals.map((meal) => meal.slotId)).toEqual([
      "dinner",
      "snack_2",
      "breakfast",
    ]);
  });

  it("6. sums planned kcal over the RESOLVED meals", () => {
    expect(resolveNutritionDay(plan, [], DAY)?.planned.kcal).toBeCloseTo(402.4 + 702.2 + 602.3, 10);

    const withOverride = resolveNutritionDay(plan, [makeSlotHead(DAY, "lunch", aiOverride("Curry", 900))], DAY);
    expect(withOverride?.planned.kcal).toBeCloseTo(402.4 + 900 + 602.3, 10);
  });

  it("7. sums each planned macro separately, unrounded", () => {
    const day = resolveNutritionDay(plan, [makeSlotHead(DAY, "lunch", aiOverride("Curry", 900))], DAY);

    // Override macros: 30 / 110 / 25.
    expect(day?.planned).toEqual({
      kcal: day?.planned.kcal,
      proteinG: 20 + 30 + 35,
      carbsG: 50 + 110 + 60,
      fatG: 10 + 25 + 25,
    });
    expect(sumPlannedValues([values(0.25, 0.1, 0.2, 0.3), values(0.25, 0.2, 0.1, 0.3)])).toEqual(
      values(0.5, 0.1 + 0.2, 0.2 + 0.1, 0.6)
    );
    expect(sumPlannedValues([])).toEqual(values(0, 0, 0, 0));
  });

  it("15. resolves a date outside the plan to no plan day", () => {
    expect(resolveNutritionDay(plan, [], "2026-09-22")).toBeNull();
    expect(resolveNutritionDay(plan, [], "2026-09-30")).toBeNull();
  });

  it("refuses a slot head of another plan or a duplicated head", () => {
    expect(() => resolveNutritionDay(plan, [makeSlotHead(DAY, "lunch", null, "plan-2")], DAY)).toThrow();
    expect(() => resolveNutritionDay(plan, [makeSlotHead(DAY, "lunch"), makeSlotHead(DAY, "lunch", null)], DAY)).toThrow();
  });
});

describe("recording coverage", () => {
  const coverage = (entries: RecordedEntry[]) => nutritionRecordingCoverage(plan.slotOrder, DAY, entries).status;

  it("9. zero entries → unrecorded", () => {
    expect(nutritionRecordingCoverage(plan.slotOrder, DAY, [])).toEqual({
      status: "unrecorded",
      recordedSlots: 0,
      configuredSlots: 3,
    });
  });

  it("10. one configured slot entry → partial", () => {
    expect(coverage([plannedMealEntry(DAY, "lunch")])).toBe("partial");
  });

  it("11. every configured slot entry → recorded", () => {
    expect(coverage(plan.slotOrder.map((slotId) => plannedMealEntry(DAY, slotId)))).toBe("recorded");
  });

  it("12. a skip is an explicit recording of its slot", () => {
    expect(coverage([skipEntry(DAY, "breakfast")])).toBe("partial");
    expect(coverage(plan.slotOrder.map((slotId) => skipEntry(DAY, slotId)))).toBe("recorded");
  });

  it("13. extra entries, other dates and unconfigured slots cover nothing", () => {
    expect(coverage([extraEntry(DAY), extraEntry(DAY, "9b2d8f5e-1c3a-4e7b-9a6d-2f4c8e1b3a5d")])).toBe("unrecorded");
    expect(coverage([plannedMealEntry("2026-09-26", "lunch")])).toBe("unrecorded");
    expect(coverage([skipEntry(DAY, "snack_1")])).toBe("unrecorded");
    expect(coverage([plannedMealEntry(DAY, "breakfast"), plannedMealEntry(DAY, "lunch"), extraEntry(DAY)])).toBe(
      "partial"
    );
  });
});

describe("buildNutritionWeek", () => {
  const TODAY = "2026-09-26";

  it("derives the seven plan days in plan order, with today marked by date", () => {
    const week = buildNutritionWeek({ plan, slotHeads: [], entries: [], today: TODAY });

    expect(week.days.map((day) => day.date)).toEqual(plan.days.map((day) => day.date));
    expect(week.days).toHaveLength(7);
    expect(week.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(week.today?.date).toBe(TODAY);
    expect(week.days.every((day) => day.mealCount === 3)).toBe(true);
    expect(Object.keys(week.days[0]).sort()).toEqual(["date", "isToday", "mealCount", "plannedKcal", "recording"]);
  });

  it("6. row kcal is the resolved day's planned kcal", () => {
    const week = buildNutritionWeek({
      plan,
      slotHeads: [makeSlotHead(DAY, "lunch", aiOverride("Curry", 900))],
      entries: [],
      today: TODAY,
    });

    expect(week.days[2].plannedKcal).toBeCloseTo(402.4 + 900 + 602.3, 10);
    expect(week.days[3].plannedKcal).toBeCloseTo(403.4 + 703.2 + 603.3, 10);
  });

  it("8. planned totals are independent of recorded entries", () => {
    const withoutEntries = buildNutritionWeek({ plan, slotHeads: [], entries: [], today: TODAY });
    const allRecorded = plan.days.flatMap((day) =>
      plan.slotOrder.map((slotId) => plannedMealEntry(day.date, slotId, values(5000, 1, 1, 1)))
    );
    const withEntries = buildNutritionWeek({ plan, slotHeads: [], entries: allRecorded, today: TODAY });

    expect(withEntries.days.map((day) => day.plannedKcal)).toEqual(withoutEntries.days.map((day) => day.plannedKcal));
    expect(withEntries.today?.planned).toEqual(withoutEntries.today?.planned);
    expect(withEntries.days.every((day) => day.recording === "recorded")).toBe(true);
    // Recorded estimates never appear in the model.
    expect(JSON.stringify(withEntries)).not.toContain("5000");
  });

  it("14. never recomputes a recorded entry from the plan or an override", () => {
    const entries = deepFrozen([plannedMealEntry(DAY, "lunch", values(111, 2, 3, 4))]);
    const snapshot = JSON.stringify(entries);

    buildNutritionWeek({ plan, slotHeads: [makeSlotHead(DAY, "lunch", aiOverride("Curry", 900))], entries, today: DAY });

    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(entries[0].nutritionEstimate).toEqual(values(111, 2, 3, 4));
  });

  it("derives each row's recording status from that date's slot entries", () => {
    const week = buildNutritionWeek({
      plan,
      slotHeads: [],
      entries: [
        ...plan.slotOrder.map((slotId) => skipEntry(PLAN_START, slotId)),
        plannedMealEntry(DAY, "dinner"),
        extraEntry(PLAN_END),
      ],
      today: TODAY,
    });

    expect(week.days.map((day) => day.recording)).toEqual([
      "recorded",
      "unrecorded",
      "partial",
      "unrecorded",
      "unrecorded",
      "unrecorded",
      "unrecorded",
    ]);
  });

  it("15. has no today when today is outside the plan", () => {
    const week = buildNutritionWeek({ plan, slotHeads: [], entries: [], today: "2026-10-01" });

    expect(week.today).toBeNull();
    expect(week.days.some((day) => day.isToday)).toBe(false);
  });

  it("16. identifies today by Berlin calendar date, not by weekday or the UTC date", () => {
    // 22:30 UTC on Saturday 26 September is already Sunday 27 September in Berlin.
    const today = nutritionDateAt(new Date("2026-09-26T22:30:00Z"));
    expect(today).toBe("2026-09-27");

    const week = buildNutritionWeek({ plan, slotHeads: [], entries: [], today });
    expect(week.today?.date).toBe("2026-09-27");

    // A plan starting on another weekday is matched by date, not by position.
    const shifted = makePlan({ startDate: "2026-09-21" });
    const shiftedWeek = buildNutritionWeek({ plan: shifted, slotHeads: [], entries: [], today });
    expect(shiftedWeek.days.findIndex((day) => day.isToday)).toBe(6);
    expect(week.days.findIndex((day) => day.isToday)).toBe(4);
  });

  it("never derives a weekday or reads a clock in the model", () => {
    const source = readFileSync(resolve(__dirname, "resolvedPlan.ts"), "utf8");
    expect(source).not.toMatch(/get(UTC)?Day\(|toLocale|DateTimeFormat|new Date\(|Date\.now/);
  });
});

describe("deriveNutritionV2TodayView", () => {
  const ok = <T,>(data: T) => ({ status: "success" as const, data });
  const TODAY = "2026-09-26";
  const base: NutritionV2TodayInputs = {
    access: { status: "eligible", uid: "alice" },
    state: ok(makeState()),
    plan: ok(plan),
    slots: ok([]),
    entries: ok([]),
    today: TODAY,
  };
  const view = (overrides: Partial<NutritionV2TodayInputs>) => deriveNutritionV2TodayView({ ...base, ...overrides });

  it("maps access to signed-out / loading / error / ineligible", () => {
    expect(view({ access: { status: "signedOut" } })).toBeNull();
    expect(view({ access: { status: "pending" } })).toEqual({ status: "loading" });
    expect(view({ access: { status: "error" } })).toEqual({ status: "error" });
    expect(view({ access: { status: "ineligible", reason: "minor" } })).toEqual({ status: "ineligible", reason: "minor" });
    expect(view({ access: { status: "ineligible", reason: "missingAge" } })).toEqual({
      status: "ineligible",
      reason: "missingAge",
    });
  });

  it("distinguishes not initialised from no active plan", () => {
    expect(view({ state: ok(null), plan: ok(null) })).toEqual({ status: "notInitialized" });
    expect(view({ state: ok(makeState({ activePlanId: null })), plan: ok(null) })).toEqual({ status: "noActivePlan" });
  });

  it("is loading while any needed read is pending, and an error when any fails", () => {
    for (const key of ["state", "plan", "slots", "entries"] as const) {
      expect(view({ [key]: { status: "pending" } })).toEqual({ status: "loading" });
      expect(view({ [key]: { status: "error", error: new Error("x") } })).toEqual({ status: "error" });
    }
    // An error wins over another read still loading.
    expect(view({ slots: { status: "pending" }, entries: { status: "error", error: new Error("x") } })).toEqual({
      status: "error",
    });
  });

  it("is today when today is a plan day, outsidePlan otherwise", () => {
    const today = view({});
    expect(today?.status).toBe("today");
    expect(today?.status === "today" && today.week.today?.date).toBe(TODAY);

    const outside = view({ today: "2026-10-05" });
    expect(outside?.status).toBe("outsidePlan");
    expect(outside?.status === "outsidePlan" && outside.week.days).toHaveLength(7);
  });

  it("never shows a plan other than the one the state points to", () => {
    expect(view({ plan: ok(makePlan({ planId: "plan-2" })) })).toEqual({ status: "loading" });
  });

  it("turns an inconsistent read set into an error, not a partial week", () => {
    expect(view({ slots: ok([makeSlotHead(DAY, "lunch", null, "plan-2")]) })).toEqual({ status: "error" });
  });
});
