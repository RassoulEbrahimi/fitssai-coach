import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Apple, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { NutritionSkeleton } from "@/components/skeletons/SectionSkeleton";
import { NutritionPlan, NutritionMeal } from "@/lib/types";

/**
 * Display-only mapping for the meal buckets stored in Firestore.
 * The stored keys are the contract and stay untouched (read-only in Phase 1);
 * only the label shown to the user and the display order are defined here.
 */
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Frühstück",
  lunch: "Mittagessen",
  dinner: "Abendessen",
  snacks: "Snacks",
  snack: "Snacks",
};

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snacks", "snack"];

const mealLabel = (key: string): string =>
  MEAL_LABELS[key.trim().toLowerCase()] ?? key;

/** Chronological order for known buckets; anything unknown keeps its order at the end. */
const mealRank = (key: string): number => {
  const index = MEAL_ORDER.indexOf(key.trim().toLowerCase());
  return index === -1 ? MEAL_ORDER.length : index;
};



/*
  Nutrition is read-only. The empty state used to offer a "Pläne jetzt
  erstellen" button wired — through Dashboard — to the *workout* plan
  generator, which itself only threw AI_UNAVAILABLE. Nothing generates
  nutrition plans in this build, so the view reports what it has and
  promises nothing.
*/
interface NutritionViewProps {
  nutritionPlan: NutritionPlan | null;
  /**
   * Initial load of the *nutrition* query. Nutrition loading used to be driven
   * by useWorkoutPlan().isLoading, so a slow workout plan blanked this tab and
   * a slow nutrition plan did not.
   */
  isLoading?: boolean;
  /** The nutrition query failed — distinct from "no plan exists". */
  isError?: boolean;
  /** Refetches the nutrition query only; nothing here generates a plan. */
  onRetry?: () => void;
}

const NutritionView: React.FC<NutritionViewProps> = React.memo(({
  nutritionPlan,
  isLoading = false,
  isError = false,
  onRetry,
}) => {
  const { t } = useTranslation();

  /*
    Precedence is conservative: usable data always wins, so a background
    refetch never replaces a visible plan with a skeleton or an error.
  */
  if (!nutritionPlan && isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('dashboard.nutritionPlan.loading')}>
        <NutritionSkeleton />
      </div>
    );
  }

  return (
    <div
      className="space-y-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        whileHover={{ scale: 1.01, boxShadow: "0 10px 25px -3px rgba(0, 0, 0, 0.1)" }}
      >
        <Card className="gradient-card border-primary/20 hover-scale">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" role="heading" aria-level={2}>
              <Apple className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('dashboard.nutritionPlan.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nutritionPlan ? (
              <div className="space-y-6">
                {Object.entries(nutritionPlan.content)
                  .sort(([a], [b]) => mealRank(a) - mealRank(b))
                  .map(([mealType, meals]) => (
                  <div key={mealType} className="space-y-3">
                    <h3 className="text-lg font-semibold text-primary">{mealLabel(mealType)}</h3>
                    <div className="grid gap-3">
                      {(Array.isArray(meals) ? meals : []).map((meal: NutritionMeal, mealIndex: number) => (
                        <motion.div
                          key={mealIndex}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: mealIndex * 0.1 }}
                          whileHover={{ scale: 1.02, y: -2 }}
                        >
                          <Card className="border-primary/10 hover-scale">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h4 className="font-medium">{meal.meal}</h4>
                                  <p className="text-sm text-muted-foreground mt-1">{meal.description}</p>
                                </div>
                                <motion.div
                                  whileHover={{ scale: 1.1 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <Badge variant="secondary" className="ml-3">
                                    {meal.calories} kcal
                                  </Badge>
                                </motion.div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  ))}
              </div>
            ) : isError ? (
              <motion.div
                className="text-center py-12 space-y-6"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
              >
                <div className="flex justify-center">
                  <AlertCircle className="h-16 w-16 text-destructive/60" aria-hidden="true" />
                </div>

                <div className="space-y-3" role="alert" aria-live="assertive">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t('dashboard.nutritionPlan.errorState.title')}
                  </h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {t('dashboard.nutritionPlan.errorState.description')}
                  </p>
                </div>

                {onRetry && (
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                    {t('dashboard.nutritionPlan.errorState.retry')}
                  </Button>
                )}
              </motion.div>
            ) : (
              <motion.div
                className="text-center py-12 space-y-6"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                role="status"
                aria-live="polite"
              >
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex justify-center"
                >
                  <Apple className="h-16 w-16 text-muted-foreground/40" aria-hidden="true" />
                </motion.div>

                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-foreground" role="heading" aria-level={2}>
                    {t('dashboard.nutritionPlan.emptyState.title')}
                  </h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {t('dashboard.nutritionPlan.emptyState.description')}
                  </p>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
});

NutritionView.displayName = 'NutritionView';

export default NutritionView;