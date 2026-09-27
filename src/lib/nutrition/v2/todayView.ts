import {
  planOwnsDate,
  type NutritionDate,
  type NutritionPlan,
  type NutritionUserState,
  type RecordedEntry,
  type SlotHead,
} from "@shared/nutrition";
import type { NutritionV2Access, NutritionV2Read } from "./readStatus";
import { buildNutritionWeek, nutritionWeekSuccessorId, type NutritionWeek, type NutritionWeekPlan } from "./resolvedPlan";

/**
 * What the Nutrition V2 Today/week shell shows, derived from its reads. Pure.
 *
 * Every state is neutral and says only what is known: no state offers or
 * promises a plan, and no state falls back to legacy Nutrition.
 */
export type NutritionV2TodayView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ineligible"; reason: "minor" | "missingAge" }
  /** No state document: V2 has not been initialised for the account. */
  | { status: "notInitialized" }
  | { status: "noActivePlan" }
  /** No plan owns today's Berlin date; the week is the latest activated plan's. */
  | { status: "outsidePlan"; week: NutritionWeek }
  | { status: "today"; week: NutritionWeek };

export interface NutritionV2TodayInputs {
  access: NutritionV2Access;
  state: NutritionV2Read<NutritionUserState | null>;
  /** The plan `state.activePlanId` names: the latest activated plan. */
  plan: NutritionV2Read<NutritionPlan | null>;
  /** The plan that owns `today` (`useNutritionV2PlanForDate`), if any. */
  todayPlan: NutritionV2Read<NutritionPlan | null>;
  /** The slot heads of the plan `selectNutritionV2TodayPlan` chose. */
  slots: NutritionV2Read<SlotHead[]>;
  /** The entries of that plan's dates. */
  entries: NutritionV2Read<RecordedEntry[]>;
  /**
   * The plan that owns the rest of the chosen plan's week, read by the id the
   * chosen plan names (`nutritionWeekSuccessorId`) — after a regeneration,
   * the successor that starts tomorrow. `null` data or absent when no plan is
   * needed.
   */
  successorPlan?: NutritionV2Read<NutritionPlan | null>;
  /** That successor's own slot heads. */
  successorSlots?: NutritionV2Read<SlotHead[]>;
  /** Today's Berlin calendar date. */
  today: NutritionDate;
}

/**
 * The plan Today shows: the one that OWNS today, whatever the state pointer
 * says — a successor activated for a later start (next week's repeat,
 * tomorrow's regeneration) leaves its predecessor owning today. Only when no
 * plan owns today is the pointer's plan shown, as the week outside of which
 * today falls.
 *
 * Each read must agree with the other: a "plan for today" that does not own
 * today is an error, and the pointer's plan must be the one the state names.
 * `null` data: nothing to show yet (no state, no activated plan).
 */
export const selectNutritionV2TodayPlan = ({
  state,
  plan,
  todayPlan,
  today,
}: Pick<NutritionV2TodayInputs, "state" | "plan" | "todayPlan" | "today">): NutritionV2Read<NutritionPlan | null> => {
  if (state.status !== "success") return state;
  const activePlanId = state.data?.activePlanId ?? null;
  if (activePlanId === null) return { status: "success", data: null };

  // The pointer's plan is read strictly even when another plan owns today: a
  // missing or malformed active plan is still an error, never skipped.
  if (plan.status !== "success") return plan;
  // The pointer read follows the pointer; until it does, there is nothing to show.
  if (plan.data === null || plan.data.planId !== activePlanId) return { status: "pending" };

  if (todayPlan.status !== "success") return todayPlan;
  if (todayPlan.data !== null) {
    if (!planOwnsDate(todayPlan.data, today)) {
      return { status: "error", error: new Error("the plan read for today does not own today") };
    }
    return todayPlan;
  }

  // No plan owns today, so the latest plan cannot either; if it does, the reads disagree.
  if (planOwnsDate(plan.data, today)) return { status: "pending" };
  return plan;
};

const LOADING: NutritionV2TodayView = { status: "loading" };
const ERROR: NutritionV2TodayView = { status: "error" };

/** `null` when signed out: there is no account to show anything for. */
export const deriveNutritionV2TodayView = ({
  access,
  state,
  plan,
  todayPlan,
  slots,
  entries,
  successorPlan = { status: "disabled" },
  successorSlots = { status: "disabled" },
  today,
}: NutritionV2TodayInputs): NutritionV2TodayView | null => {
  switch (access.status) {
    case "signedOut":
      return null;
    case "pending":
      return LOADING;
    case "error":
      return ERROR;
    case "ineligible":
      return { status: "ineligible", reason: access.reason };
    case "eligible":
      break;
  }

  if (state.status === "error") return ERROR;
  if (state.status !== "success") return LOADING;
  if (state.data === null) return { status: "notInitialized" };
  if (state.data.activePlanId === null) return { status: "noActivePlan" };

  const shown = selectNutritionV2TodayPlan({ state, plan, todayPlan, today });
  if (shown.status === "error") return ERROR;
  if (shown.status !== "success" || shown.data === null) return LOADING;

  if (slots.status === "error" || entries.status === "error") return ERROR;
  if (slots.status !== "success" || entries.status !== "success") return LOADING;

  // The week is always seven dates. Dates the chosen plan handed on are
  // resolved from the plan that owns them, so that plan is needed too.
  let successor: NutritionWeekPlan | null = null;
  const successorId = nutritionWeekSuccessorId(shown.data);
  if (successorId !== null) {
    if (successorPlan.status === "error" || successorSlots.status === "error") return ERROR;
    if (successorPlan.status !== "success" || successorSlots.status !== "success") return LOADING;
    // The by-id read follows the chosen plan; until it does, there is nothing to show.
    if (successorPlan.data === null || successorPlan.data.planId !== successorId) return LOADING;
    successor = { plan: successorPlan.data, slotHeads: successorSlots.data };
  }

  let week: NutritionWeek;
  try {
    week = buildNutritionWeek({ plan: shown.data, slotHeads: slots.data, successor, entries: entries.data, today });
  } catch {
    return ERROR;
  }
  return week.today ? { status: "today", week } : { status: "outsidePlan", week };
};
