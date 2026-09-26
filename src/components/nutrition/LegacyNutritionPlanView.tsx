import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import type { LegacyNutritionPlan } from "@/lib/nutrition/legacy";

/**
 * Display-only mapping for the meal buckets stored in legacy Firestore plans.
 * The stored keys are the contract and stay untouched (legacy is read-only);
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

// Own keys only: a stored bucket named "constructor" must not resolve to
// Object.prototype.constructor.
const mealLabel = (key: string): string => {
  const normalised = key.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MEAL_LABELS, normalised) ? MEAL_LABELS[normalised] : key;
};

/** Chronological order for known buckets; anything unknown keeps its order at the end. */
const mealRank = (key: string): number => {
  const index = MEAL_ORDER.indexOf(key.trim().toLowerCase());
  return index === -1 ? MEAL_ORDER.length : index;
};

interface LegacyNutritionPlanViewProps {
  legacyNutritionPlan: LegacyNutritionPlan;
}

/**
 * Read-only compatibility rendering of one legacy `nutrition_plans` document.
 * It accepts only the legacy model: Nutrition V2 plans have their own UI.
 */
export const LegacyNutritionPlanView: React.FC<LegacyNutritionPlanViewProps> = ({ legacyNutritionPlan }) => (
  <div className="space-y-6" data-testid="legacy-nutrition-plan">
    {[...legacyNutritionPlan.buckets]
      .sort((a, b) => mealRank(a.key) - mealRank(b.key))
      .map((bucket) => (
      <div key={bucket.key} className="space-y-3">
        <h3 className="text-lg font-semibold text-primary">{mealLabel(bucket.key)}</h3>
        <div className="grid gap-3">
          {bucket.meals.map((meal, mealIndex) => (
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
                    {meal.caloriesText !== null && (
                      <motion.div
                        whileHover={{ scale: 1.1 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Badge variant="secondary" className="ml-3">
                          {meal.caloriesText} kcal
                        </Badge>
                      </motion.div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
      ))}
  </div>
);

LegacyNutritionPlanView.displayName = "LegacyNutritionPlanView";
