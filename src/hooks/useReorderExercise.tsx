import { useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { logEvent, logError } from "@/lib/telemetryClient";
import { useSupabaseAction } from "./useSupabaseAction";
import { DayContent, WorkoutPlanContent } from "@/lib/types";
import { PlanEditBlockedError, assertExpectedExercise, assertPlanEditPreservesHistory, planEditLane } from "@/lib/exerciseHistoryGuard";
import { reconcilePlanAfterFailedEdit } from "./planEditReconcile";
import { moveItem } from "@/lib/trainingsplanEdit";

export interface ReorderExerciseParams {
  planId: string; weekKey: string; dayIndex: number; fromIndex: number; toIndex: number;
  /** The name the caller saw at `fromIndex`; a different one means the list changed underneath. */
  exerciseName: string;
}
interface ReorderExerciseResponse {
  success: boolean; content?: WorkoutPlanContent; queued?: boolean;
}
type CachedPlan = { content?: WorkoutPlanContent } | undefined;
interface ReorderContext { previousPlan?: CachedPlan }

/**
 * Moves one exercise within one plan day (TRAINING-PLAN-V2-02).
 *
 * The same day-level write as delete and restore: read the plan, rebuild only
 * this day's exercise array, write the content back. Every exercise object is
 * carried over as it is, so a move changes the order and nothing else. It runs
 * in the plan's edit lane, so a quick second move (or a removal right after
 * it) reads the first one's result instead of racing it.
 */
export function useReorderExercise() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const reorderMutation = useSupabaseAction<ReorderExerciseResponse, ReorderExerciseParams, ReorderContext>({
    action: async (params): Promise<ReorderExerciseResponse> => {
      if (!user) throw new Error("Not authenticated");
      const planRef = doc(db, "users", user.uid, "workout_plans", params.planId);
      const snap = await getDoc(planRef);
      if (!snap.exists()) throw new Error("Plan not found");

      const content = snap.data().content as WorkoutPlanContent;
      const week = content[params.weekKey];
      const day = Array.isArray(week) ? week[params.dayIndex] : undefined;
      if (!Array.isArray(day?.exercises)) throw new Error("Day or exercises not found");
      // Fail fast on a list that is not the one the user moved in.
      assertExpectedExercise(day.exercises, params.fromIndex, params.exerciseName);
      if (!Number.isInteger(params.toIndex) || params.toIndex < 0 || params.toIndex >= day.exercises.length) {
        throw new PlanEditBlockedError("stale-target");
      }

      // Every position between the two ends comes to hold a different
      // exercise, so history logged there would be re-pointed.
      await assertPlanEditPreservesHistory({
        uid: user.uid,
        planId: params.planId,
        content,
        weekKey: params.weekKey,
        dayIndex: params.dayIndex,
        edit: { kind: "move", exerciseIndex: params.fromIndex, toIndex: params.toIndex },
      });

      // Immediately before the write: still the exercise the user moved.
      assertExpectedExercise(day.exercises, params.fromIndex, params.exerciseName);
      const exercises = moveItem(day.exercises, params.fromIndex, params.toIndex);
      const updatedContent = {
        ...content,
        [params.weekKey]: week.map((d, i) => (i === params.dayIndex ? { ...d, exercises } : d)),
      };
      await setDoc(planRef, { content: updatedContent, updatedAt: Timestamp.now() }, { merge: true });
      return { success: true, content: updatedContent };
    },
    messages: { error: "Reihenfolge konnte nicht gespeichert werden" },
    serializeKey: (params) => planEditLane(params.planId),
    onMutate: async (params) => {
      logEvent("exercise_reorder_started", params);
      await queryClient.cancelQueries({ queryKey: ["workout-plan", params.planId] });
      const previousPlan = queryClient.getQueryData<CachedPlan>(["workout-plan", params.planId]);
      queryClient.setQueryData<CachedPlan>(["workout-plan", params.planId], (old) => {
        const w = old?.content?.[params.weekKey];
        const d: DayContent | undefined = Array.isArray(w) ? w[params.dayIndex] : undefined;
        if (!old?.content || !w || !d || !Array.isArray(d.exercises) || d.exercises[params.fromIndex]?.name !== params.exerciseName) return old;
        let exercises;
        try {
          exercises = moveItem(d.exercises, params.fromIndex, params.toIndex);
        } catch {
          return old;
        }
        const week = w.map((day, i) => (i === params.dayIndex ? { ...d, exercises } : day));
        return { ...old, content: { ...old.content, [params.weekKey]: week } };
      });
      return { previousPlan };
    },
    onError: (error: unknown, params: ReorderExerciseParams, context: ReorderContext | undefined) => {
      // Back to the plan as stored, not to a snapshot of possibly failed edits.
      void reconcilePlanAfterFailedEdit(queryClient, user?.uid, params.planId, context?.previousPlan);
      logError(error, "exercise_reorder_failed");
    },
    onSuccess: (data: ReorderExerciseResponse, params: ReorderExerciseParams) => {
      if (data.content && !data.queued) {
        queryClient.setQueryData<CachedPlan>(["workout-plan", params.planId], (old) => ({ ...old, content: data.content }));
      }
      queryClient.invalidateQueries({ queryKey: ["workout-plan", params.planId] });
      logEvent("exercise_reorder_success", { planId: params.planId, weekKey: params.weekKey, dayIndex: params.dayIndex });
    },
  });

  return {
    reorderExercise: reorderMutation.mutate,
    /**
     * One promise per move. `mutate`'s per-call callbacks fire only for the
     * latest call on this hook, so rapid moves that each need their own
     * outcome use this instead.
     */
    reorderExerciseAsync: reorderMutation.mutateAsync,
    isReordering: reorderMutation.isPending,
  };
}
