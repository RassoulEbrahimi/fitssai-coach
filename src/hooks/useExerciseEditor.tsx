import { useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { logEvent, logError } from "@/lib/telemetryClient";
import { useSupabaseAction } from "./useSupabaseAction";
import { Exercise, WorkoutPlanContent } from "@/lib/types";

export type { Exercise };

export interface UpdateExerciseParams {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number; exercise: Exercise;
}
interface UpdateExerciseResponse {
  success: boolean; content?: WorkoutPlanContent; queued?: boolean;
}

export function useExerciseEditor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const updateExerciseMutation = useSupabaseAction<UpdateExerciseResponse, UpdateExerciseParams>({
    action: async (params): Promise<UpdateExerciseResponse> => {
      if (!user) throw new Error("Not authenticated");
      const planRef = doc(db, "users", user.uid, "workout_plans", params.planId);
      const snap = await getDoc(planRef);
      if (!snap.exists()) throw new Error("Plan not found");

      const content = snap.data().content as any;
      const week = [...(content[params.weekKey] || [])];
      const day = { ...(week[params.dayIndex] || {}) };
      const exercises = [...(day.exercises || [])];
      if (!exercises[params.exerciseIndex]) throw new Error("Exercise not found");
      exercises[params.exerciseIndex] = { ...exercises[params.exerciseIndex], ...params.exercise };
      day.exercises = exercises;
      week[params.dayIndex] = day;
      const updatedContent = { ...content, [params.weekKey]: week };

      await setDoc(planRef, { content: updatedContent, updatedAt: Timestamp.now() }, { merge: true });
      return { success: true, content: updatedContent };
    },
    onMutate: async (params) => {
      logEvent("exercise_update_started", params);
      await queryClient.cancelQueries({ queryKey: ["workout-plan", params.planId] });
      const previousPlan = queryClient.getQueryData(["workout-plan", params.planId]);
      queryClient.setQueryData(["workout-plan", params.planId], (old: any) => {
        if (!old?.content) return old;
        const c = { ...old.content };
        const w = [...(c[params.weekKey] || [])];
        if (w[params.dayIndex]) {
          const d = { ...w[params.dayIndex] };
          const exs = [...(d.exercises || [])];
          if (exs[params.exerciseIndex]) exs[params.exerciseIndex] = { ...exs[params.exerciseIndex], ...params.exercise };
          d.exercises = exs;
          w[params.dayIndex] = d;
          c[params.weekKey] = w;
        }
        return { ...old, content: c };
      });
      return { previousPlan };
    },
    onError: (error: any, params: UpdateExerciseParams, context: { previousPlan?: any } | undefined) => {
      if (context?.previousPlan) queryClient.setQueryData(["workout-plan", params.planId], context.previousPlan);
      logError(error, "exercise_update_failed");
      toast({ title: t("workout.updateFailed") || "Update failed", description: error.message, variant: "destructive" });
    },
    onSuccess: (data: UpdateExerciseResponse, params: UpdateExerciseParams) => {
      if (data.content && !data.queued) {
        queryClient.setQueriesData({ queryKey: ["workout-plan", params.planId] },
          (old: any) => ({ ...old, content: data.content }));
      }
      queryClient.invalidateQueries({ queryKey: ["workout-plan", params.planId] });
      logEvent("exercise_update_success", { planId: params.planId, exerciseName: params.exercise.name });
      toast({ title: t("workout.updateSuccess") || "Exercise updated", description: `${params.exercise.name} has been saved` });
    },
  });

  return { updateExercise: updateExerciseMutation.mutate, isUpdating: updateExerciseMutation.isPending, error: updateExerciseMutation.error };
}
