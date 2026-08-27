import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { WorkoutPlan } from "@/lib/types";
import {
  PlanGenerationError,
  generateWorkoutPlan,
  newRequestId,
  toPlanGenerationError,
} from "@/lib/backend/planGeneration";
import { planGenerationErrorMessage } from "@/lib/backend/planGenerationCopy";


export const useWorkoutPlan = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query_ = useQuery({
    queryKey: queryKeys.plans.byUser(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const plansRef = collection(db, "users", user.uid, "workout_plans");
      const snap = await getDocs(query(plansRef, orderBy("createdAt", "desc"), limit(1)));
      if (snap.empty) return null;
      const d = snap.docs[0];
      const data = d.data() as Record<string, any>;
      return {
        id:         d.id,
        user_id:    user.uid,
        content:    data.content ?? {},
        created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
        updated_at: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : null,
      } as unknown as WorkoutPlan;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });

  /*
    Real generation, server-side. The browser sends one request id and nothing
    else: goal, equipment, days and session length are read from the profile by
    the Function, and the plan is written by the Function too. A retried click
    reuses the same id, so a double-click cannot become two plans or two
    charges against a three-per-month quota.
  */
  const generateMutation = useMutation({
    mutationFn: async () => generateWorkoutPlan(newRequestId()),

    onSuccess: async (result) => {
      // Refetch before telling the user it worked, so the new plan is what
      // they see when the toast appears.
      await queryClient.invalidateQueries({ queryKey: queryKeys.plans.byUser(user?.id) });

      toast.success("Neuer Trainingsplan erstellt", {
        description:
          result.quota.remaining > 0
            ? `Noch ${result.quota.remaining} von ${result.quota.limit} Plänen diesen Monat.`
            : "Dein letzter Plan für diesen Monat.",
      });
    },

    onError: (error: unknown) => {
      const failure =
        error instanceof PlanGenerationError ? error : toPlanGenerationError(error);
      const message = planGenerationErrorMessage(failure.code, {
        missingFields: failure.missingFields,
        limit: failure.limit,
      });

      // Never the raw error: a callable message carries a function name, a
      // region and a request id, none of which belong in front of a user.
      toast.error(message.title, { description: message.description });
    },
  });

  return {
    ...query_,
    generatePlan: generateMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
  };
};

// Helper: update plan content directly in Firestore
export const updatePlanContent = async (userId: string, planId: string, content: any) => {
  await setDoc(doc(db, "users", userId, "workout_plans", planId), { content, updatedAt: Timestamp.now() }, { merge: true });
};
