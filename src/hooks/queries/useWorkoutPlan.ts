import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { WorkoutPlan } from "@/lib/types";

const AI_UNAVAILABLE = "AI_UNAVAILABLE";

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

  const generateMutation = useMutation({
    mutationFn: async () => {
      throw new Error(AI_UNAVAILABLE);
    },
    onError: (error: any) => {
      if (error.message === AI_UNAVAILABLE) {
        toast.info("KI-Generierung vorübergehend deaktiviert", {
          description: "Diese Funktion steht derzeit nicht zur Verfügung.",
        });
      } else {
        toast.error(error.message || "Fehler beim Erstellen der Pläne");
      }
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
