import type { NutritionDate, NutritionPlan, NutritionUserState, RecordedEntry, SlotHead } from "@shared/nutrition";
import type { NutritionV2Access, NutritionV2Read } from "./readStatus";
import { buildNutritionWeek, type NutritionWeek } from "./resolvedPlan";

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
  /** A plan is active, but today's Berlin date is not one of its days. */
  | { status: "outsidePlan"; week: NutritionWeek }
  | { status: "today"; week: NutritionWeek };

export interface NutritionV2TodayInputs {
  access: NutritionV2Access;
  state: NutritionV2Read<NutritionUserState | null>;
  plan: NutritionV2Read<NutritionPlan | null>;
  slots: NutritionV2Read<SlotHead[]>;
  entries: NutritionV2Read<RecordedEntry[]>;
  /** Today's Berlin calendar date. */
  today: NutritionDate;
}

const LOADING: NutritionV2TodayView = { status: "loading" };
const ERROR: NutritionV2TodayView = { status: "error" };

/** `null` when signed out: there is no account to show anything for. */
export const deriveNutritionV2TodayView = ({
  access,
  state,
  plan,
  slots,
  entries,
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

  if (plan.status === "error") return ERROR;
  if (plan.status !== "success") return LOADING;
  // The plan read follows the pointer, so this is the plan the state names.
  if (plan.data === null || plan.data.planId !== state.data.activePlanId) return LOADING;

  if (slots.status === "error" || entries.status === "error") return ERROR;
  if (slots.status !== "success" || entries.status !== "success") return LOADING;

  let week: NutritionWeek;
  try {
    week = buildNutritionWeek({ plan: plan.data, slotHeads: slots.data, entries: entries.data, today });
  } catch {
    return ERROR;
  }
  return week.today ? { status: "today", week } : { status: "outsidePlan", week };
};
