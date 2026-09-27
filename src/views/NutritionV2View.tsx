import { useAuth } from "@/hooks/useAuth";
import { NutritionV2TodayContainer } from "@/components/nutrition/v2/NutritionV2TodayContainer";

/** A separate V2 root: account changes also reset sheets and local UI state. */
export default function NutritionV2View() {
  const { user } = useAuth();
  return user ? <NutritionV2TodayContainer key={user.uid} /> : null;
}
