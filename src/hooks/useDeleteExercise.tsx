import { useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { logEvent, logError } from "@/lib/telemetryClient";
import { useSupabaseAction } from "./useSupabaseAction";
import { WorkoutPlanContent } from "@/lib/types";

export type { WorkoutPlanContent };

interface DeleteExerciseParams {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
}
interface DeleteExerciseResponse {
  success: boolean; content?: WorkoutPlanContent; queued?: boolean;
}

export function useDeleteExercise() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const deleteExerciseMutation = useSupabaseAction<DeleteExerciseResponse, DeleteExerciseParams>({
    action: async (params): Promise<DeleteExerciseResponse> => {
      if (!user) throw new Error("Not authenticated");
      const planRef = doc(db, "users", user.uid, "workout_plans", params.planId);
      const snap = await getDoc(planRef);
      if (!snap.exists()) throw new Error("Plan not found");

      const content = snap.data().content as WorkoutPlanContent;
      const week = content[params.weekKey] || [];
      const day = week[params.dayIndex];
      if (!day?.exercises) throw new Error("Day or exercises not found");

      const updatedContent = {
        ...content,
        [params.weekKey]: week.map((d: any, i: number) =>
          i === params.dayIndex
            ? { ...d, exercises: d.exercises.filter((_: any, idx: number) => idx !== params.exerciseIndex) }
            : d
        ),
      };
      await setDoc(planRef, { content: updatedContent, updatedAt: Timestamp.now() }, { merge: true });
      return { success: true, content: updatedContent };
    },
    messages: { success: "Übung gelöscht", error: "Fehler beim Löschen der Übung" },
    onMutate: async (params) => {
      logEvent("exercise_delete_started", params);
      await queryClient.cancelQueries({ queryKey: ["workout-plan", params.planId] });
      const previousPlan = queryClient.getQueryData(["workout-plan", params.planId]);
      queryClient.setQueryData(["workout-plan", params.planId], (old: any) => {
        if (!old?.content) return old;
        const c = { ...old.content };
        const w = [...(c[params.weekKey] || [])];
        if (w[params.dayIndex]) {
          const d = { ...w[params.dayIndex] };
          d.exercises = (d.exercises || []).filter((_: any, i: number) => i !== params.exerciseIndex);
          w[params.dayIndex] = d;
          c[params.weekKey] = w;
        }
        return { ...old, content: c };
      });
      return { previousPlan };
    },
    onError: (error: any, params: DeleteExerciseParams, context: { previousPlan?: any } | undefined) => {
      if (context?.previousPlan) queryClient.setQueryData(["workout-plan", params.planId], context.previousPlan);
      logError(error, "exercise_delete_failed");
    },
    onSuccess: (data: DeleteExerciseResponse, params: DeleteExerciseParams) => {
      if (data.content && !data.queued) {
        queryClient.setQueryData(["workout-plan", params.planId], (old: any) => ({ ...old, content: data.content }));
      }
      queryClient.invalidateQueries({ queryKey: ["workout-plan", params.planId] });
      logEvent("exercise_delete_success", { planId: params.planId });
    },
  });

  return { deleteExercise: deleteExerciseMutation.mutate, isDeleting: deleteExerciseMutation.isPending, error: deleteExerciseMutation.error };
}
