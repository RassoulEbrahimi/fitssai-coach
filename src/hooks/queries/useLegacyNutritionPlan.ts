import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { NUTRITION_LEGACY_PLANS_COLLECTION } from "@shared/nutrition/collections";
import { toLegacyNutritionPlan, type LegacyNutritionPlan } from "@/lib/nutrition/legacy";

/**
 * The owner's latest legacy Nutrition plan, read-only.
 *
 * Legacy only: it reads `nutrition_plans` and nothing from Nutrition V2, has no
 * write path, and passes the unknown stored document through the tolerant
 * display adapter instead of casting it. `null` means no legacy plan exists.
 */
export const useLegacyNutritionPlan = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.nutritionLegacy.latest(user?.id),
    queryFn: async (): Promise<LegacyNutritionPlan | null> => {
      if (!user) return null;
      const ref = collection(db, "users", user.uid, NUTRITION_LEGACY_PLANS_COLLECTION);
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(1)));
      if (snap.empty) return null;
      const d = snap.docs[0];
      return toLegacyNutritionPlan(d.id, d.data());
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
};
