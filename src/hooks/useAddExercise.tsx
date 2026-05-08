import { useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { useSupabaseAction } from "./useSupabaseAction";
import { Exercise, WorkoutPlan } from "@/lib/types";

interface AddExerciseParams {
  planId: string; weekKey: string; dayIndex: number; exercise: Exercise;
}
interface AddExerciseResponse {
  success: boolean; updatedPlan?: WorkoutPlan; error?: string; queued?: boolean;
}

export const useAddExercise = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const addExerciseMutation = useSupabaseAction<AddExerciseResponse, AddExerciseParams>({
    action: async ({ planId, weekKey, dayIndex, exercise }) => {
      if (!user) throw new Error("Not authenticated");
      const planRef = doc(db, "users", user.uid, "workout_plans", planId);
      const snap = await getDoc(planRef);
      if (!snap.exists()) throw new Error("Plan not found");

      const content = JSON.parse(JSON.stringify(snap.data().content || {}));
      if (!content[weekKey]) content[weekKey] = [];
      if (!content[weekKey][dayIndex] || typeof content[weekKey][dayIndex] !== "object") {
        content[weekKey][dayIndex] = {
          day: ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"][dayIndex],
          exercises: [],
        };
      }
      if (!Array.isArray(content[weekKey][dayIndex].exercises)) content[weekKey][dayIndex].exercises = [];
      content[weekKey][dayIndex].exercises.push(exercise);

      await setDoc(planRef, { content, updatedAt: Timestamp.now() }, { merge: true });
      return { success: true };
    },
    messages: { success: "Die Übung wurde erfolgreich hinzugefügt", error: "Übung konnte nicht hinzugefügt werden" },
    onMutate: async ({ planId, weekKey, dayIndex, exercise }) => {
      await queryClient.cancelQueries({ queryKey: ["workout-plan", planId] });
      const previousPlan = queryClient.getQueryData(["workout-plan", planId]);
      queryClient.setQueryData(["workout-plan", planId], (old: any) => {
        if (!old) return old;
        const c = JSON.parse(JSON.stringify(old.content));
        if (!c[weekKey]) c[weekKey] = [];
        if (!c[weekKey][dayIndex] || typeof c[weekKey][dayIndex] !== "object")
          c[weekKey][dayIndex] = { day: ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"][dayIndex], exercises: [] };
        if (!Array.isArray(c[weekKey][dayIndex].exercises)) c[weekKey][dayIndex].exercises = [];
        c[weekKey][dayIndex].exercises.push(exercise);
        return { ...old, content: c };
      });
      return { previousPlan };
    },
    onError: (_e: any, vars: AddExerciseParams, context: { previousPlan?: any } | undefined) => {
      if (context?.previousPlan) queryClient.setQueryData(["workout-plan", vars.planId], context.previousPlan);
    },
    onSuccess: (_d: any, vars: AddExerciseParams) => {
      queryClient.invalidateQueries({ queryKey: ["workout-plan", vars.planId] });
    },
  });

  return { addExercise: addExerciseMutation.mutate, isAdding: addExerciseMutation.isPending, error: addExerciseMutation.error };
};
