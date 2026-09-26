import React, { useMemo } from "react";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import {
  useActiveNutritionV2Plan,
  useNutritionV2Access,
  useNutritionV2EntriesRange,
  useNutritionV2Slots,
  useNutritionV2State,
} from "@/hooks/queries/useNutritionV2";
import { useNutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import { buildNutritionDayRecordings } from "@/lib/nutrition/v2/dayRecordings";
import { deriveNutritionV2TodayView } from "@/lib/nutrition/v2/todayView";
import { NutritionV2TodayShell } from "./NutritionV2TodayShell";
import { NutritionV2TodayRecording } from "./NutritionV2TodayRecording";

/**
 * Nutrition V2 Today/week data container.
 *
 * Reads state → active plan → its slot heads and the entries of its seven
 * dates, derives the planned week, and hands it to the shell. Every read is
 * gated on a signed-in, eligible (adult) account, so an ineligible or
 * signed-out person causes no V2 Firestore read at all.
 *
 * When today is a plan day it also offers online recording for today's slots
 * and extra meals (NUT-06). Rendering writes nothing; only a confirmed action
 * in the recording sheet does. Only today is offered — never a future date,
 * and backfilling earlier days is not part of this surface.
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
  const recording = useNutritionV2Recording();

  const view = deriveNutritionV2TodayView({ access, state, plan, slots, entries, today });
  const todayDay = view?.status === "today" ? view.week.today : null;
  const entryList = entries.status === "success" ? entries.data : null;
  const recordings = useMemo(
    () => (todayDay && entryList ? buildNutritionDayRecordings(todayDay, entryList) : null),
    [todayDay, entryList]
  );

  if (!view) return null;
  return (
    <NutritionV2TodayShell
      view={view}
      todayRecording={recordings ? <NutritionV2TodayRecording recordings={recordings} recording={recording} /> : null}
    />
  );
};

NutritionV2TodayContainer.displayName = "NutritionV2TodayContainer";
