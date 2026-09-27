import { planMealReplacementCandidates, type NutritionPlan, type PlannedMeal } from "@shared/nutrition";
import type { NutritionSlotRecording } from "./dayRecordings";
import type { NutritionEntryPendingState } from "./nutritionWriteIntents";

/**
 * Whether one of today's slots can be replaced or undone right now, and with
 * what (NUT-10). Pure: no Firestore, React or clock.
 *
 * The server decides; this only keeps the UI truthful. A slot is blocked
 * while:
 *
 *   offline        replacement needs the server; nothing is queued for it
 *   recorded       the slot has an active recording — the server copy, or
 *                  this device's projected (not yet synchronised) one
 *   pendingRecord  a recording change for the slot still waits to be
 *                  synchronised, so what the server holds is not known yet
 *
 * Account availability (signed out, pending, ineligible) is the hook's.
 */
export type NutritionSlotReplacementBlock = "offline" | "recorded" | "pendingRecord";

export const nutritionSlotReplacementBlock = ({
  online,
  slot,
  pending,
}: {
  online: boolean;
  slot: NutritionSlotRecording;
  /** The slot entry's pending local change, if any (`useNutritionV2EntryOverlay`). */
  pending: NutritionEntryPendingState | undefined;
}): NutritionSlotReplacementBlock | null => {
  if (slot.active) return "recorded";
  if (pending) return "pendingRecord";
  if (!online) return "offline";
  return null;
};

export interface NutritionSlotReplacementChoices {
  /** Other BASE meals of the same plan for the same slot. Never an override, never another plan's meal. */
  planMeals: PlannedMeal[];
  /** The slot shows an override, so Undo can go back one step. */
  canUndo: boolean;
}

/**
 * What the person may choose for `slot`, from the plan that owns its date.
 * The slot must be that plan's: a meal of another plan is never offered.
 */
export const nutritionSlotReplacementChoices = (
  plan: NutritionPlan,
  slot: NutritionSlotRecording
): NutritionSlotReplacementChoices => {
  const { meal } = slot;
  if (meal.planId !== plan.planId) throw new Error(`slot of plan ${meal.planId} offered replacements from plan ${plan.planId}`);
  return {
    planMeals: planMealReplacementCandidates(plan, meal.date, meal.slotId),
    canUndo: meal.source === "override",
  };
};
