import { useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { Exercise, WorkoutPlanContent } from "@/lib/types";
import { logEvent, logError } from "@/lib/telemetryClient";
import { useSupabaseAction } from "./useSupabaseAction";

export interface RestoreExerciseParams {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number; exercise: Exercise;
}
interface RestoreExerciseResponse {
  success: boolean; content?: WorkoutPlanContent; queued?: boolean;
}

export function useRestoreExercise() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const restoreExerciseMutation = useSupabaseAction<RestoreExerciseResponse, RestoreExerciseParams>({
    action: async (params): Promise<RestoreExerciseResponse> => {
      if (!user) throw new Error("Not authenticated");
      const planRef = doc(db, "users", user.uid, "workout_plans", params.planId);
      const snap = await getDoc(planRef);
      if (!snap.exists()) throw new Error("Plan not found");

      const content = snap.data().content as any;
      const week = content[params.weekKey] || [];
      const day = week[params.dayIndex];
      if (!day) throw new Error("Day not found");

      const exercises = [...(day.exercises || [])];
      exercises.splice(params.exerciseIndex, 0, params.exercise);
      const updatedContent = {
        ...content,
        [params.weekKey]: week.map((d: any, i: number) =>
          i === params.dayIndex ? { ...d, exercises } : d
        ),
      };
      await setDoc(planRef, { content: updatedContent, updatedAt: Timestamp.now() }, { merge: true });
      return { success: true, content: updatedContent };
    },
    messages: { success: "Übung wiederhergestellt", error: "Fehler beim Wiederherstellen der Übung" },
    onMutate: async (params) => {
      logEvent("exercise_restore_started", params);
      await queryClient.cancelQueries({ queryKey: ["workout-plan", params.planId] });
      const previousPlan = queryClient.getQueryData(["workout-plan", params.planId]);
      queryClient.setQueryData(["workout-plan", params.planId], (old: any) => {
        if (!old?.content) return old;
        const c = { ...old.content };
        const w = [...(c[params.weekKey] || [])];
        if (w[params.dayIndex]) {
          const d = { ...w[params.dayIndex] };
          const exs = [...(d.exercises || [])];
          exs.splice(params.exerciseIndex, 0, params.exercise);
          d.exercises = exs;
          w[params.dayIndex] = d;
          c[params.weekKey] = w;
        }
        return { ...old, content: c };
      });
      return { previousPlan };
    },
    onError: (error: any, params: RestoreExerciseParams, context: { previousPlan?: any } | undefined) => {
      if (context?.previousPlan) queryClient.setQueryData(["workout-plan", params.planId], context.previousPlan);
      logError(error, "exercise_restore_failed");
    },
    onSuccess: (data: RestoreExerciseResponse, params: RestoreExerciseParams) => {
      if (data.content && !data.queued) {
        queryClient.setQueryData(["workout-plan", params.planId], (old: any) => ({ ...old, content: data.content }));
      }
      queryClient.invalidateQueries({ queryKey: ["workout-plan", params.planId] });
      logEvent("exercise_restore_success", { planId: params.planId });
    },
  });

  return { restoreExercise: restoreExerciseMutation.mutate, isRestoring: restoreExerciseMutation.isPending, error: restoreExerciseMutation.error };
}
