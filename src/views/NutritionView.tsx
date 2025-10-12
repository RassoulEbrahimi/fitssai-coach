import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Apple } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

interface NutritionViewProps {
  nutritionPlan: any;
}

const NutritionView: React.FC<NutritionViewProps> = React.memo(({ nutritionPlan }) => {
  const { t } = useTranslation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="nutrition-content"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="px-4 md:px-6"
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
                  {Object.entries(nutritionPlan.content).map(([mealType, meals]: [string, any]) => (
                    <div key={mealType} className="space-y-3">
                      <h3 className="text-lg font-semibold capitalize text-primary">{mealType}</h3>
                      <div className="grid gap-3">
                        {(Array.isArray(meals) ? meals : []).map((meal: any, mealIndex: number) => (
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
                                      {meal.calories} cal
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
              ) : (
                <motion.div 
                  className="text-center py-12 space-y-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  role="status"
                  aria-live="polite"
                >
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {t('dashboard.nutritionPlan.emptyTitle')}
                    </h3>
                    <p className="text-muted-foreground">
                      {t('dashboard.nutritionPlan.emptyDescription')}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground/70">
                    {t('dashboard.nutritionPlan.emptyAction')}
                  </p>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

NutritionView.displayName = 'NutritionView';

export default NutritionView;