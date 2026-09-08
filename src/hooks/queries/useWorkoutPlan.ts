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
  toPlanGenerationError,
} from "@/lib/backend/planGeneration";
import {
  beginPlanRequest,
  isUncertainOutcome,
  settlePlanRequest,
} from "@/lib/backend/planRequestId";
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
    the Function, and the plan is written by the Function too.

    The id is the whole of the duplicate protection, so it is chosen by
    `beginPlanRequest` rather than minted here. A press whose outcome nobody
    knows — a lost response, a callable that gave up, a server that says it is
    still working — keeps its id, so the retry reaches the server as the same
    request and is answered with the plan that request already produced. Only a
    finished generation or a refusal that persisted nothing clears it, which is
    what makes the *next* press a genuinely new plan.
  */
  const generateMutation = useMutation({
    mutationFn: async () => {
      const ownerUid = user?.uid;
      if (!ownerUid) throw new PlanGenerationError("UNAUTHENTICATED");

      try {
        const result = await generateWorkoutPlan(beginPlanRequest(ownerUid));
        settlePlanRequest(ownerUid);
        return result;
      } catch (error) {
        const failure =
          error instanceof PlanGenerationError ? error : toPlanGenerationError(error);
        // An uncertain outcome keeps its id: the server may well have finished,
        // and the next attempt has to be able to ask about this same request
        // rather than starting a second one.
        if (!isUncertainOutcome(failure.code)) settlePlanRequest(ownerUid);
        throw failure;
      }
    },

    onSuccess: async (result) => {
      // Refetch before telling the user it worked, so the plan is what they
      // see when the toast appears.
      await queryClient.invalidateQueries({ queryKey: queryKeys.plans.byUser(user?.id) });

      /*
        A replay is a success, not a duplicate-generation error: the server
        recognised this as a request it had already completed and handed back
        the plan it made. Saying so is more honest than announcing a new plan
        that was not created just now — and than reporting a failure for a
        request that succeeded.
      */
      toast.success(
        result.replay ? "Dein Trainingsplan ist fertig" : "Neuer Trainingsplan erstellt",
        {
          description:
            result.quota.remaining > 0
              ? `Noch ${result.quota.remaining} von ${result.quota.limit} Plänen diesen Monat.`
              : "Dein letzter Plan für diesen Monat.",
        }
      );
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
