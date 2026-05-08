import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, limit, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { NutritionPlan } from "@/lib/types";

export const useNutritionPlan = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["nutrition-plan", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const ref = collection(db, "users", user.uid, "nutrition_plans");
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(1)));
      if (snap.empty) return null;
      const d = snap.docs[0];
      const data = d.data() as Record<string, any>;
      return {
        id:         d.id,
        user_id:    user.uid,
        content:    data.content ?? {},
        created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
        updated_at: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : null,
      } as unknown as NutritionPlan;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
};
