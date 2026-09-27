import { describe, expect, it } from "vitest";
import { addNutritionDays, type NutritionPlan } from "@shared/nutrition";
import { NutritionV2IntegrityError, parseNutritionV2PlanForDate } from "./integrity";
import { buildNutritionWeek } from "./resolvedPlan";
import { buildNutritionDayRecordings } from "./dayRecordings";
import { deriveNutritionV2TodayView, selectNutritionV2TodayPlan, type NutritionV2TodayInputs } from "./todayView";
import { queryKeys } from "@/lib/queryKeys";
import { PLAN_END, PLAN_START, aiOverride, makePlan, makeSlotHead, makeState } from "@/test/nutritionV2Fixtures";

/*
  NUT-09: the plan Today shows is the plan that OWNS today, not necessarily
  the one `state.activePlanId` names. A repeat activates next week's plan while
  the source still owns the rest of this week; a regeneration activates a plan
  from tomorrow while the old one still owns today. Both must keep Today on
  the owning plan.
*/

const ok = <T,>(data: T) => ({ status: "success" as const, data });

/** The NUT-09 repeat scenario: source 23–29 Sep, superseded by next week's 30 Sep – 6 Oct. */
const SOURCE: NutritionPlan = {
  ...makePlan({ planId: "plan-1" }),
  lifecycle: { status: "superseded", effectiveUntil: PLAN_END, supersededByPlanId: "plan-2" },
};
const REPEAT: NutritionPlan = {
  ...makePlan({ planId: "plan-2", startDate: "2026-09-30" }),
  source: "repeated",
  repeatedFromPlanId: "plan-1",
};
const STATE_AFTER_REPEAT = makeState({ activePlanId: "plan-2", revision: 5 });

/** Today is Monday 28 Sep; the source owns it and the next day. */
const TODAY = "2026-09-28";

const raw = (plan: unknown, id = (plan as NutritionPlan).planId) => [{ id, data: plan }];

/** What the date query returns: the plan with the latest startDate <= date. */
const candidate = (plans: NutritionPlan[], date: string) =>
  plans
    .filter((plan) => plan.startDate <= date)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .slice(0, 1);

const planForDate = (plans: NutritionPlan[], date: string) =>
  parseNutritionV2PlanForDate(date, candidate(plans, date).flatMap((plan) => raw(plan)));

const integrity = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NutritionV2IntegrityError);
    return error as NutritionV2IntegrityError;
  }
  throw new Error("expected an integrity error");
};

/* ------------------------------------------------------------------ *
 * The date-owned read
 * ------------------------------------------------------------------ */

describe("the plan that owns a date", () => {
  it("after a repeat: the source owns 28 and 29 Sep, the repeat owns 30 Sep onwards", () => {
    const plans = [SOURCE, REPEAT];
    expect(STATE_AFTER_REPEAT.activePlanId).toBe("plan-2");

    expect(planForDate(plans, "2026-09-28")).toEqual(SOURCE);
    expect(planForDate(plans, "2026-09-29")).toEqual(SOURCE);
    expect(planForDate(plans, "2026-09-30")).toEqual(REPEAT);
    expect(planForDate(plans, "2026-10-06")).toEqual(REPEAT);
  });

  it("after a regeneration from tomorrow: the old plan owns today, the successor tomorrow", () => {
    const old: NutritionPlan = {
      ...makePlan({ planId: "plan-1" }),
      lifecycle: { status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "plan-2" },
    };
    const regenerated = makePlan({ planId: "plan-2", startDate: "2026-09-29" });
    expect(planForDate([old, regenerated], TODAY)).toEqual(old);
    expect(planForDate([old, regenerated], "2026-09-29")).toEqual(regenerated);
  });

  it("returns the current active plan that owns the date, as before", () => {
    const active = makePlan();
    expect(planForDate([active], TODAY)).toEqual(active);
    expect(planForDate([active], PLAN_START)).toEqual(active);
  });

  it("is null for a date no plan owns", () => {
    expect(planForDate([SOURCE, REPEAT], "2026-09-22")).toBeNull();
    expect(planForDate([SOURCE, REPEAT], "2026-10-07")).toBeNull();
    expect(planForDate([], TODAY)).toBeNull();
    // A superseded plan past its effectiveUntil owns nothing, even inside its own week.
    const cut: NutritionPlan = { ...SOURCE, lifecycle: { ...SOURCE.lifecycle, effectiveUntil: "2026-09-25" } as NutritionPlan["lifecycle"] };
    expect(parseNutritionV2PlanForDate(TODAY, raw(cut))).toBeNull();
  });

  it("is an integrity error for a malformed candidate", () => {
    const { lifecycle: _lifecycle, ...withoutLifecycle } = SOURCE;
    expect(integrity(() => parseNutritionV2PlanForDate(TODAY, raw(withoutLifecycle, "plan-1"))).code).toBe("malformed");
    expect(integrity(() => parseNutritionV2PlanForDate(TODAY, raw({ ...SOURCE, days: SOURCE.days.slice(0, 6) }))).code).toBe(
      "malformed"
    );
  });

  it("is an integrity error when the Firestore id is not the planId", () => {
    const error = integrity(() => parseNutritionV2PlanForDate(TODAY, raw(SOURCE, "plan-9")));
    expect(error.code).toBe("idMismatch");
    expect(error.documentPath).toBe("nutrition_v2_plans/plan-9");
  });

  it("is an integrity error for a candidate the query should not have returned", () => {
    expect(integrity(() => parseNutritionV2PlanForDate("2026-09-22", raw(SOURCE))).code).toBe("outOfScope");
    expect(integrity(() => parseNutritionV2PlanForDate(TODAY, [...raw(SOURCE), ...raw(REPEAT)])).code).toBe("outOfScope");
  });

  it("needs a calendar date", () => {
    expect(() => parseNutritionV2PlanForDate("Monday", [])).toThrow(RangeError);
  });

  it("has an account- and date-scoped key under plans.all, which an activation invalidates", () => {
    const alice = queryKeys.nutrition.plans.forDate("alice", TODAY, "plan-2");
    const bob = queryKeys.nutrition.plans.forDate("bob", TODAY, "plan-2");
    expect(alice).not.toEqual(bob);
    expect(alice.slice(0, 3)).toEqual([...queryKeys.nutrition.plans.all("alice")]);
    expect(bob.slice(0, 3)).toEqual([...queryKeys.nutrition.plans.all("bob")]);
    expect(queryKeys.nutrition.plans.forDate("alice", "2026-09-29", "plan-2")).not.toEqual(alice);
    // A new state pointer is a new read.
    expect(queryKeys.nutrition.plans.forDate("alice", TODAY, "plan-3")).not.toEqual(alice);
  });
});

/* ------------------------------------------------------------------ *
 * Today
 * ------------------------------------------------------------------ */

describe("Today after a future successor was activated", () => {
  const inputs = (overrides: Partial<NutritionV2TodayInputs> = {}): NutritionV2TodayInputs => ({
    access: { status: "eligible", uid: "alice" },
    state: ok(STATE_AFTER_REPEAT),
    plan: ok(REPEAT),
    todayPlan: ok(SOURCE),
    slots: ok([]),
    entries: ok([]),
    today: TODAY,
    ...overrides,
  });

  it("shows the source, which owns 28 Sep: status today, not outsidePlan", () => {
    expect(selectNutritionV2TodayPlan(inputs())).toEqual(ok(SOURCE));

    const view = deriveNutritionV2TodayView(inputs());
    expect(view?.status).toBe("today");
    if (view?.status !== "today") return;
    expect(view.week.planId).toBe("plan-1");
    expect(view.week.today?.date).toBe(TODAY);
    expect(view.week.today?.planId).toBe("plan-1");
    // The source's week runs through its own effectiveUntil.
    expect(view.week.days.map((day) => day.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addNutritionDays(PLAN_START, index))
    );
  });

  it("records today against the source plan", () => {
    const view = deriveNutritionV2TodayView(inputs());
    if (view?.status !== "today" || !view.week.today) throw new Error("expected today");
    const recordings = buildNutritionDayRecordings(view.week.today, []);
    expect(recordings.date).toBe(TODAY);
    const planIds = recordings.slots.map((slot) => (slot.meal as { planId?: string }).planId);
    expect(new Set(planIds)).toEqual(new Set(["plan-1"]));
  });

  it("uses the source's own slot heads, never the future plan's", () => {
    const sourceHead = makeSlotHead(TODAY, "lunch", aiOverride("Override on the source", 777), "plan-1");
    const view = deriveNutritionV2TodayView(inputs({ slots: ok([sourceHead]) }));
    if (view?.status !== "today") throw new Error("expected today");
    expect(view.week.today?.meals.find((meal) => meal.slotId === "lunch")?.name).toBe("Override on the source");

    // A future plan's head handed to the source's week is refused, not shown.
    const futureHead = makeSlotHead("2026-09-30", "lunch", aiOverride("Future", 1), "plan-2");
    expect(deriveNutritionV2TodayView(inputs({ slots: ok([futureHead]) }))).toEqual({ status: "error" });
  });

  it("switches to the repeat on its first day", () => {
    const view = deriveNutritionV2TodayView(inputs({ today: "2026-09-30", todayPlan: ok(REPEAT) }));
    expect(view?.status === "today" && view.week.planId).toBe("plan-2");
  });

  it("after a regeneration from tomorrow, today stays on the old plan and shows only the dates it owns", () => {
    const old: NutritionPlan = {
      ...makePlan({ planId: "plan-1" }),
      lifecycle: { status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "plan-2" },
    };
    const regenerated = makePlan({ planId: "plan-2", startDate: "2026-09-29" });
    const view = deriveNutritionV2TodayView(inputs({ plan: ok(regenerated), todayPlan: ok(old) }));

    expect(view?.status).toBe("today");
    if (view?.status !== "today") return;
    expect(view.week.planId).toBe("plan-1");
    expect(view.week.today?.planId).toBe("plan-1");
    // 29 Sep belongs to the successor, so the old week stops at today.
    expect(view.week.days.map((day) => day.date)).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
    ]);
    expect(view.week.endDate).toBe(TODAY);
  });

  it("shows the latest plan as outsidePlan only when no plan owns today", () => {
    const view = deriveNutritionV2TodayView(inputs({ today: "2026-10-10", todayPlan: ok(null) }));
    expect(view?.status).toBe("outsidePlan");
    expect(view?.status === "outsidePlan" && view.week.planId).toBe("plan-2");
  });

  it("refuses reads that disagree", () => {
    // A "plan for today" that does not own today.
    expect(deriveNutritionV2TodayView(inputs({ todayPlan: ok(REPEAT) }))).toEqual({ status: "error" });
    // No owner reported, yet the pointer's plan owns today: wait for the reads to agree.
    expect(deriveNutritionV2TodayView(inputs({ today: "2026-09-30", todayPlan: ok(null) }))).toEqual({ status: "loading" });
    // The pointer read must still be the plan the state names, and still be read strictly.
    expect(deriveNutritionV2TodayView(inputs({ plan: ok(SOURCE) }))).toEqual({ status: "loading" });
    expect(deriveNutritionV2TodayView(inputs({ plan: { status: "error", error: new Error("x") } }))).toEqual({ status: "error" });
  });

  it("builds the source's week from its owned dates only, leaving an active plan's seven", () => {
    expect(buildNutritionWeek({ plan: makePlan(), slotHeads: [], entries: [], today: TODAY }).days).toHaveLength(7);
    const cut: NutritionPlan = { ...SOURCE, lifecycle: { ...SOURCE.lifecycle, effectiveUntil: "2026-09-25" } as NutritionPlan["lifecycle"] };
    const week = buildNutritionWeek({ plan: cut, slotHeads: [], entries: [], today: TODAY });
    expect(week.days.map((day) => day.date)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(week.today).toBeNull();
  });
});
