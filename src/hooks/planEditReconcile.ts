import type { QueryClient } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { planEditLane } from "@/lib/exerciseHistoryGuard";
import type { WorkoutPlanContent } from "@/lib/types";
import { runInLane } from "./useSupabaseAction";

type CachedPlan = { content?: WorkoutPlanContent } | undefined;

/**
 * Put the cached plan back on the plan as stored, after a plan edit failed.
 *
 * Restoring the failed edit's own snapshot is not safe once edits are chained:
 * the snapshot was taken on top of the optimistic results of the edits queued
 * before it, and any of those may itself have failed. Only the server knows
 * the truth, so it is read - in the plan's edit lane, after every edit queued
 * before this failure has settled and before any later one writes - and the
 * cache takes exactly that content. Later edits still in the lane re-apply
 * themselves when they land (their success writes the stored content back).
 *
 * If the plan cannot be read, the failed edit's snapshot is the best available
 * fallback and the query is marked stale so the next read corrects it.
 */
export const reconcilePlanAfterFailedEdit = (
  queryClient: QueryClient,
  uid: string | undefined,
  planId: string,
  fallback: CachedPlan
): Promise<void> => {
  const key = ["workout-plan", planId];
  return runInLane(planEditLane(planId), async () => {
    try {
      if (!uid) throw new Error("Not authenticated");
      const snap = await getDoc(doc(db, "users", uid, "workout_plans", planId));
      if (!snap.exists()) throw new Error("Plan not found");
      const content = (snap.data().content ?? {}) as WorkoutPlanContent;
      queryClient.setQueryData<CachedPlan>(key, (old) => (old ? { ...old, content } : old));
    } catch {
      if (fallback) queryClient.setQueryData(key, fallback);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }).catch(() => undefined);
};
