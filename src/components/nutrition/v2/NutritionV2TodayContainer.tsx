import React, { useMemo } from "react";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import {
  useActiveNutritionV2Plan,
  useNutritionV2Access,
  useNutritionV2EntriesRange,
  useNutritionV2PlanForDate,
  useNutritionV2Slots,
  useNutritionV2State,
} from "@/hooks/queries/useNutritionV2";
import { useNutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import { useNutritionV2EntryOverlay } from "@/hooks/queries/useNutritionV2EntryOverlay";
import { useNutritionV2SlotOverride } from "@/hooks/queries/useNutritionV2SlotOverride";
import { buildNutritionDayRecordings } from "@/lib/nutrition/v2/dayRecordings";
import { deriveNutritionV2TodayView, selectNutritionV2TodayPlan } from "@/lib/nutrition/v2/todayView";
import { NutritionV2TodayShell } from "./NutritionV2TodayShell";
import { NutritionV2TodayRecording } from "./NutritionV2TodayRecording";
import { NutritionV2Conflicts } from "./NutritionV2Conflicts";
import { NutritionV2TargetSection } from "./NutritionV2TargetSection";

/**
 * Nutrition V2 Today/week data container.
 *
 * Reads state → the plan that OWNS today (NUT-09) → its slot heads and the
 * entries of its dates, derives the planned week, and hands it to the shell.
 * The owning plan is not always the one `state.activePlanId` names: a
 * successor activated for a later start (next week's repeat, tomorrow's
 * regeneration) leaves its predecessor owning today, and Today, the week and
 * recording stay on that predecessor. Only when no plan owns today is the
 * pointer's plan shown, as the week today falls outside of. Every read is
 * gated on a signed-in, eligible (adult) account, so an ineligible or
 * signed-out person causes no V2 Firestore read at all.
 *
 * When today is a plan day it also offers recording for today's slots and
 * extra meals (NUT-06), online or queued offline (NUT-07). Rendering writes
 * nothing; only a confirmed action in the recording sheet does. Only today is
 * offered — never a future date, and backfilling earlier days is not part of
 * this surface.
 *
 * Today's slots can also be replaced with another base meal of the plan that
 * owns today, or a replacement undone (NUT-10) — through that plan's own slot
 * heads, never the state pointer's successor. It is online-only and
 * confirmed by the server before anything shown changes.
 *
 * The recorded entries shown are the strict committed read with this
 * account's own queued changes laid over it (`useNutritionV2EntryOverlay`).
 * Plans, slot heads and targets are shown exactly as read. The current
 * TARGET and its setup (NUT-08) are their own section, shown whenever the
 * account is eligible — with or without a plan. A rejected offline
 * change is shown as a conflict — whatever the view: without a plan, outside
 * it, or for another date — until the person applies it again or discards it.
 *
 * Not mounted anywhere while `NUTRITION_V2_ENABLED` is false: the app still
 * shows legacy Nutrition, and this container never falls back to it.
 */
export const NutritionV2TodayContainer: React.FC = () => {
  const access = useNutritionV2Access();
  const state = useNutritionV2State();
  const today = useBerlinToday();
  const plan = useActiveNutritionV2Plan();
  const todayPlan = useNutritionV2PlanForDate(today);
  const shown = selectNutritionV2TodayPlan({ state, plan, todayPlan, today });
  const shownPlan = shown.status === "success" ? shown.data : null;
  // Slot heads and entries of the plan shown — never of a later successor.
  const slots = useNutritionV2Slots(shownPlan);
  const committedEntries = useNutritionV2EntriesRange(shownPlan?.startDate, shownPlan?.endDate);
  const overlay = useNutritionV2EntryOverlay(committedEntries, shownPlan?.startDate, shownPlan?.endDate);
  const entries = overlay.entries;
  const recording = useNutritionV2Recording();
  const slotOverride = useNutritionV2SlotOverride();

  const view = deriveNutritionV2TodayView({ access, state, plan, todayPlan, slots, entries, today });
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
      conflicts={<NutritionV2Conflicts conflicts={overlay.conflicts} today={today} recording={recording} />}
      target={<NutritionV2TargetSection />}
      todayRecording={
        recordings ? (
          <NutritionV2TodayRecording
            recordings={recordings}
            recording={recording}
            pending={overlay.pending}
            // The plan that owns today — the one the recordings were resolved from.
            replacement={shownPlan ? { plan: shownPlan, slotOverride } : undefined}
          />
        ) : null
      }
    />
  );
};

NutritionV2TodayContainer.displayName = "NutritionV2TodayContainer";
