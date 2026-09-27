import { describe, expect, it } from "vitest";
import type { NutritionPlan } from "@shared/nutrition";
import { buildNutritionDayRecordings } from "./dayRecordings";
import { buildNutritionWeek, nutritionWeekSuccessorId } from "./resolvedPlan";
import { deriveNutritionV2TodayView, type NutritionV2TodayInputs } from "./todayView";
import { aiOverride, makePlan, makeSlotHead, makeState, plannedMealEntry, skipEntry } from "@/test/nutritionV2Fixtures";

/*
  NUT-11 regression: after a regeneration the predecessor owns today and its
  successor owns tomorrow onwards — and Today's "Diese Woche" keeps its frozen
  seven rows. Each date resolves PLANNED against the plan that owns it: never
  the successor for today, never the predecessor's meals past its
  effectiveUntil, never two plans combined by weekday, and neither plan edited.
*/

const ok = <T,>(data: T) => ({ status: "success" as const, data });

const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Today: Monday 28 Sep (Berlin). */
const TODAY = "2026-09-28";
const TOMORROW = "2026-09-29";

/** Plan A (23–29 Sep), after the regeneration: it owns 28 Sep and nothing later. */
const PLAN_A: NutritionPlan = deepFreeze({
  ...makePlan({ planId: "plan-a" }),
  lifecycle: { status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "plan-b" },
});
/** Plan B, the generated successor: from 29 Sep, with four slots of its own. */
const PLAN_B: NutritionPlan = deepFreeze({
  ...makePlan({ planId: "plan-b", startDate: TOMORROW, slotOrder: ["breakfast", "lunch", "snack_1", "dinner"] }),
  generationRequestId: "00000000-0000-4000-8000-000000000011",
});

const inputs = (overrides: Partial<NutritionV2TodayInputs> = {}): NutritionV2TodayInputs => ({
  access: { status: "eligible", uid: "alice" },
  state: ok(makeState({ activePlanId: "plan-b", revision: 6 })),
  plan: ok(PLAN_B),
  todayPlan: ok(PLAN_A),
  slots: ok([]),
  entries: ok([]),
  successorPlan: ok(PLAN_B),
  successorSlots: ok([]),
  today: TODAY,
  ...overrides,
});

const todayWeek = (overrides: Partial<NutritionV2TodayInputs> = {}) => {
  const view = deriveNutritionV2TodayView(inputs(overrides));
  if (view?.status !== "today") throw new Error(`expected today, got ${view?.status}`);
  return view.week;
};

describe("Today after a regeneration: predecessor today, successor from tomorrow", () => {
  it("keeps exactly seven compact rows: A's week, 28 Sep from A, 29 Sep from B", () => {
    const week = todayWeek();
    expect(week.days).toHaveLength(7);
    expect(week.days.map((day) => [day.date, day.planId])).toEqual([
      ["2026-09-23", "plan-a"],
      ["2026-09-24", "plan-a"],
      ["2026-09-25", "plan-a"],
      ["2026-09-26", "plan-a"],
      ["2026-09-27", "plan-a"],
      [TODAY, "plan-a"],
      [TOMORROW, "plan-b"],
    ]);
    expect(week.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(week.planId).toBe("plan-a");
  });

  it("resolves today from A — the future successor never owns today", () => {
    const week = todayWeek();
    expect(week.today?.planId).toBe("plan-a");
    expect(week.today?.meals.map((meal) => meal.planId)).toEqual(["plan-a", "plan-a", "plan-a"]);
  });

  it("records today against A", () => {
    const recordings = buildNutritionDayRecordings(todayWeek().today!, []);
    expect(recordings.date).toBe(TODAY);
    expect(new Set(recordings.slots.map((slot) => (slot.meal as { planId?: string }).planId))).toEqual(new Set(["plan-a"]));
  });

  it("shows 29 Sep from B's own meals and slots — never A's meals past its effectiveUntil", () => {
    const week = todayWeek();
    const tomorrow = week.days.find((day) => day.date === TOMORROW)!;
    const bDay0 = PLAN_B.days[0].meals.reduce((sum, meal) => sum + meal.values.kcal, 0);
    const aDay6 = PLAN_A.days[6].meals.reduce((sum, meal) => sum + meal.values.kcal, 0);
    expect(tomorrow.mealCount).toBe(4);
    expect(tomorrow.plannedKcal).toBeCloseTo(bDay0, 10);
    expect(tomorrow.plannedKcal).not.toBeCloseTo(aDay6, 5);
  });

  it("resolves 29 Sep slot heads against B; A's head for that date is never applied", () => {
    const bHead = makeSlotHead(TOMORROW, "lunch", aiOverride("B's replacement", 1000), "plan-b");
    const aHead = makeSlotHead(TOMORROW, "lunch", aiOverride("A's stale replacement", 5), "plan-a");
    const week = todayWeek({ slots: ok([aHead]), successorSlots: ok([bHead]) });
    const tomorrow = week.days.find((day) => day.date === TOMORROW)!;
    const bBase = PLAN_B.days[0].meals.filter((meal) => meal.slotId !== "lunch").reduce((sum, meal) => sum + meal.values.kcal, 0);
    expect(tomorrow.plannedKcal).toBeCloseTo(bBase + 1000, 10);
    expect(tomorrow.planId).toBe("plan-b");
  });

  it("refuses heads handed to the wrong plan rather than confusing two plans' meals", () => {
    const bHead = makeSlotHead(TOMORROW, "lunch", aiOverride("B's", 1000), "plan-b");
    // A plan-b head in A's own list, or a plan-a head in B's, is an error — never shown.
    expect(deriveNutritionV2TodayView(inputs({ slots: ok([bHead]) }))).toEqual({ status: "error" });
    const aHead = makeSlotHead(TODAY, "lunch", aiOverride("A's", 1), "plan-a");
    expect(deriveNutritionV2TodayView(inputs({ successorSlots: ok([aHead]) }))).toEqual({ status: "error" });
  });

  it("counts recording coverage per owning plan: 29 Sep against B's four slots", () => {
    const entries = [plannedMealEntry(TODAY, "lunch", undefined, "plan-a"), skipEntry(TOMORROW, "snack_1")];
    const week = todayWeek({ entries: ok(entries) });
    expect(week.days.find((day) => day.date === TODAY)?.recording).toBe("partial");
    expect(week.days.find((day) => day.date === TOMORROW)?.recording).toBe("partial");
  });

  it("waits for the successor, and fails on a successor read error — never a shorter week", () => {
    expect(nutritionWeekSuccessorId(PLAN_A)).toBe("plan-b");
    expect(deriveNutritionV2TodayView(inputs({ successorPlan: { status: "pending" } }))).toEqual({ status: "loading" });
    expect(deriveNutritionV2TodayView(inputs({ successorSlots: { status: "pending" } }))).toEqual({ status: "loading" });
    expect(deriveNutritionV2TodayView(inputs({ successorPlan: { status: "disabled" } }))).toEqual({ status: "loading" });
    expect(deriveNutritionV2TodayView(inputs({ successorPlan: { status: "error", error: new Error("x") } }))).toEqual({ status: "error" });
    expect(deriveNutritionV2TodayView(inputs({ successorSlots: { status: "error", error: new Error("x") } }))).toEqual({ status: "error" });
    // A read that has not followed the named successor yet.
    expect(deriveNutritionV2TodayView(inputs({ successorPlan: ok(null) }))).toEqual({ status: "loading" });
  });

  it("refuses a successor that is not the one A names, or does not own the dates A handed on", () => {
    const other = makePlan({ planId: "plan-x", startDate: TOMORROW });
    expect(() => buildNutritionWeek({ plan: PLAN_A, slotHeads: [], successor: { plan: other, slotHeads: [] }, entries: [], today: TODAY })).toThrow();
    const late = makePlan({ planId: "plan-b", startDate: "2026-09-30" });
    expect(() => buildNutritionWeek({ plan: PLAN_A, slotHeads: [], successor: { plan: late, slotHeads: [] }, entries: [], today: TODAY })).toThrow();
  });

  it("never needs a successor for a plan that owns its whole week, and never reads by weekday", () => {
    expect(nutritionWeekSuccessorId(PLAN_B)).toBeNull();
    const repeatedSource: NutritionPlan = { ...makePlan(), lifecycle: { status: "superseded", effectiveUntil: "2026-09-29", supersededByPlanId: "plan-2" } };
    expect(nutritionWeekSuccessorId(repeatedSource)).toBeNull();
    // On B's own days the week is B's seven, from B alone.
    const week = buildNutritionWeek({ plan: PLAN_B, slotHeads: [], entries: [], today: TOMORROW });
    expect(week.days.map((day) => day.planId)).toEqual(Array(7).fill("plan-b"));
    expect(week.today?.planId).toBe("plan-b");
  });

  it("changes neither plan", () => {
    const before = JSON.stringify([PLAN_A, PLAN_B]);
    todayWeek({ successorSlots: ok([makeSlotHead(TOMORROW, "lunch", aiOverride("B's", 10), "plan-b")]) });
    expect(JSON.stringify([PLAN_A, PLAN_B])).toBe(before);
    expect(Object.isFrozen(PLAN_A.days[0].meals[0])).toBe(true);
  });
});
