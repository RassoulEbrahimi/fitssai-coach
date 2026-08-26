import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection, getDocs, query, where, addDoc, updateDoc, doc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseAction } from "@/hooks/useSupabaseAction";
import { queryKeys } from "@/lib/queryKeys";
import { WorkoutLog } from "@/lib/types";
import { readDurationSec } from "@/lib/workoutLog";

const docToLog = (id: string, data: Record<string, any>, userId: string): WorkoutLog => ({
  id,
  user_id:       userId,
  plan_id:       data.planId       ?? null,
  workout_day:   data.workoutDay   ?? null,
  completed:     data.completed    ?? false,
  completed_at:  data.completedAt  instanceof Timestamp ? data.completedAt.toDate().toISOString() : null,
  week_key:      data.weekKey      ?? null,
  day_index:     data.dayIndex     ?? null,
  exercise_index:data.exerciseIndex?? null,
  // Absent on every document written before PR47; null means "not measured",
  // which is not the same as "trained for no time".
  duration_sec:  readDurationSec(data.durationSec),
} as unknown as WorkoutLog);

interface ToggleDayParams {
  workoutDateStr: string;
  completed: boolean;
  weekKey?: string;
  dayIndex?: number;
}

export const useWorkoutLogs = (planId?: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.logs.byPlan(planId, user?.id);

  const query_ = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user || !planId) return [];
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      const snap = await getDocs(query(logsRef, where("planId", "==", planId)));
      return snap.docs.map(d => docToLog(d.id, d.data() as Record<string, any>, user.uid));
    },
    enabled: !!user && !!planId,
    staleTime: 1000 * 60 * 5,
  });

  const toggleDayMutation = useSupabaseAction({
    action: async ({ workoutDateStr, completed, weekKey, dayIndex }: ToggleDayParams) => {
      if (!user || !planId) throw new Error("Missing user or plan");
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      const snap = await getDocs(query(logsRef, where("planId", "==", planId), where("workoutDay", "==", workoutDateStr)));
      /*
        New writes also carry weekKey/dayIndex so a day log can be placed in the
        plan without re-deriving it from created_at. Both are optional: a caller
        that does not know them still produces a valid document, and existing
        documents keep working without them.
      */
      const position =
        weekKey !== undefined && dayIndex !== undefined ? { weekKey, dayIndex } : {};

      if (!snap.empty) {
        await updateDoc(doc(db, "users", user.uid, "workout_logs", snap.docs[0].id), {
          ...position,
          completed,
          completedAt: completed ? Timestamp.now() : null,
        });
      } else {
        await addDoc(logsRef, {
          planId, workoutDay: workoutDateStr, ...position, completed,
          completedAt: completed ? Timestamp.now() : null,
          createdAt: Timestamp.now(),
        });
      }
      return { completed };
    },
    queryKey: [...queryKey],
    messages: { error: "Fehler beim Speichern" },
    onMutate: async ({ workoutDateStr, completed }: ToggleDayParams) => {
      await queryClient.cancelQueries({ queryKey });
      const previousLogs = queryClient.getQueryData<WorkoutLog[]>(queryKey);
      queryClient.setQueryData(queryKey, (old: WorkoutLog[] = []) => {
        const idx = old.findIndex(l => l.workout_day === workoutDateStr);
        if (idx > -1) {
          const n = [...old]; n[idx] = { ...n[idx], completed }; return n;
        }
        return [...old, { workout_day: workoutDateStr, completed, plan_id: planId, user_id: user!.id } as unknown as WorkoutLog];
      });
      return { previousLogs };
    },
    onError: (_err: unknown, _v: any, context: { previousLogs?: WorkoutLog[] } | undefined) => {
      if (context?.previousLogs) queryClient.setQueryData(queryKey, context.previousLogs);
    },
  });

  return {
    ...query_,
    toggleDay: toggleDayMutation.mutate,
    isToggling: toggleDayMutation.isPending,
  };
};
