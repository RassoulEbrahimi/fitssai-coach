import React from "react";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import {
  useActiveNutritionV2Plan,
  useNutritionV2Access,
  useNutritionV2EntriesRange,
  useNutritionV2Slots,
  useNutritionV2State,
} from "@/hooks/queries/useNutritionV2";
import { deriveNutritionV2TodayView } from "@/lib/nutrition/v2/todayView";
import { NutritionV2TodayShell } from "./NutritionV2TodayShell";

/**
 * Nutrition V2 Today/week data container.
 *
 * Reads state → active plan → its slot heads and the entries of its seven
 * dates, derives the planned week, and hands it to the read-only shell. Every
 * read is gated on a signed-in, eligible (adult) account, so an ineligible or
 * signed-out person causes no V2 Firestore read at all.
 *
 * Not mounted anywhere while `NUTRITION_V2_ENABLED` is false: the app still
 * shows legacy Nutrition, and this container never falls back to it.
 */
export const NutritionV2TodayContainer: React.FC = () => {
  const access = useNutritionV2Access();
  const state = useNutritionV2State();
  const plan = useActiveNutritionV2Plan();
  const activePlan = plan.status === "success" ? plan.data : null;
  const slots = useNutritionV2Slots(activePlan);
  const entries = useNutritionV2EntriesRange(activePlan?.startDate, activePlan?.endDate);
  const today = useBerlinToday();

  const view = deriveNutritionV2TodayView({ access, state, plan, slots, entries, today });
  return view ? <NutritionV2TodayShell view={view} /> : null;
};

NutritionV2TodayContainer.displayName = "NutritionV2TodayContainer";
