import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import {
  useActiveNutritionV2Plan,
  useCurrentNutritionV2Target,
  useNutritionV2Access,
  useNutritionV2EntriesRange,
  useNutritionV2PlanById,
  useNutritionV2PlanForDate,
  useNutritionV2Slots,
  useNutritionV2State,
} from "@/hooks/queries/useNutritionV2";
import { useNutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import { useNutritionV2EntryOverlay } from "@/hooks/queries/useNutritionV2EntryOverlay";
import { useNutritionV2SlotOverride } from "@/hooks/queries/useNutritionV2SlotOverride";
import { buildNutritionDayRecordings } from "@/lib/nutrition/v2/dayRecordings";
import { deriveNutritionV2TodayView, selectNutritionV2TodayPlan } from "@/lib/nutrition/v2/todayView";
import { nutritionWeekSuccessorId } from "@/lib/nutrition/v2/resolvedPlan";
import { NutritionV2TodayShell } from "./NutritionV2TodayShell";
import { NutritionV2TodayRecording } from "./NutritionV2TodayRecording";
import { NutritionV2Conflicts } from "./NutritionV2Conflicts";
import { NutritionV2TargetSection } from "./NutritionV2TargetSection";
import { NutritionV2GenerationStatus } from "./NutritionV2GenerationStatus";
import { NutritionV2ProfileSection } from "./NutritionV2ProfileCompletion";

/**
 * Nutrition V2 Today/week data container.
 *
 * Reads state → the plan that OWNS today (NUT-09) → its slot heads and the
 * entries of its dates, derives the planned week, and hands it to the shell.
 * The week is always that plan's seven dates; a date it handed on to a
 * successor (a regeneration from tomorrow, NUT-11) is resolved from that
 * successor and its own slot heads.
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
 * Mounted by the V2 product view (NUT-12D). The rollout flag chooses the
 * whole tab; this container never falls back to legacy data. Target setup
 * and new AI requests remain unavailable in this rollout.
 *
 * The Nutrition PROFILE section (NUT-12D.1) is offered to every signed-in
 * account whose profile could be read — eligible or not — because an account
 * without an age can only become eligible by answering it. It reads and saves
 * the profile only. Without a target or a plan it is the whole empty state:
 * a completion prompt, or once complete, one "ready" message.
 */
export const NutritionV2TodayContainer: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const access = useNutritionV2Access();
  const state = useNutritionV2State();
  const today = useBerlinToday();
  const plan = useActiveNutritionV2Plan();
  const todayPlan = useNutritionV2PlanForDate(today);
  const shown = selectNutritionV2TodayPlan({ state, plan, todayPlan, today });
  const shownPlan = shown.status === "success" ? shown.data : null;
  // Slot heads and entries of the plan shown — never of a later successor.
  const slots = useNutritionV2Slots(shownPlan);
  // After a regeneration the old plan owns today only; the rest of its week
  // belongs to the successor it names, read with that plan's own slot heads.
  const successorPlan = useNutritionV2PlanById(shownPlan ? nutritionWeekSuccessorId(shownPlan) : null);
  const successorSlots = useNutritionV2Slots(successorPlan.status === "success" ? successorPlan.data : null);
  const committedEntries = useNutritionV2EntriesRange(shownPlan?.startDate, shownPlan?.endDate);
  const overlay = useNutritionV2EntryOverlay(committedEntries, shownPlan?.startDate, shownPlan?.endDate);
  const entries = overlay.entries;
  const recording = useNutritionV2Recording();
  const slotOverride = useNutritionV2SlotOverride();

  // The same query the target section reads; here only to tell an empty account apart.
  const target = useCurrentNutritionV2Target();

  const view = deriveNutritionV2TodayView({ access, state, plan, todayPlan, slots, entries, successorPlan, successorSlots, today });
  const todayDay = view?.status === "today" ? view.week.today : null;
  const entryList = entries.status === "success" ? entries.data : null;
  const recordings = useMemo(
    () => (todayDay && entryList ? buildNutritionDayRecordings(todayDay, entryList) : null),
    [todayDay, entryList]
  );

  if (!view) return null;

  // Neither a target nor a plan: the profile section is the one empty state.
  const empty =
    (view.status === "notInitialized" || view.status === "noActivePlan") &&
    target.status === "success" &&
    target.data === null;
  const profileReason = access.status === "eligible" ? "eligible" : access.status === "ineligible" ? access.reason : null;

  // Only this account's V2 reads — or its profile, when that could not be read.
  const refresh = async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: access.status === "error" ? queryKeys.profile.me(user.uid) : queryKeys.nutrition.all(user.uid),
      });
    } finally {
      setRefreshing(false);
    }
  };
  const refreshLabel = t(refreshing ? "nutritionV2.product.refreshing" : "nutritionV2.product.refresh");

  return (
    <div className="space-y-4">
      <NutritionV2TodayShell
        view={view}
        headerAction={
          access.status === "eligible" || access.status === "error" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-my-2.5 -mr-2.5 h-11 w-11 shrink-0 text-muted-foreground"
              aria-label={refreshLabel}
              title={refreshLabel}
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} aria-hidden="true" />
            </Button>
          ) : undefined
        }
        profile={profileReason ? <NutritionV2ProfileSection reason={profileReason} showReady={empty} /> : null}
        profileIsEmptyState={empty}
        conflicts={<NutritionV2Conflicts conflicts={overlay.conflicts} today={today} recording={recording} />}
        target={<>{!empty && <NutritionV2TargetSection />}<NutritionV2GenerationStatus /></>}
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
    </div>
  );
};

NutritionV2TodayContainer.displayName = "NutritionV2TodayContainer";
