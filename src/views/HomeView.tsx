import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Flame, Target, TrendingUp, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";

interface HomeViewProps {
  generatingPlans: boolean;
  workoutPlan: any;
  nutritionPlan: any;
  onGeneratePlans: () => void;
}

const HomeView: React.FC<HomeViewProps> = ({
  generatingPlans,
  workoutPlan,
  nutritionPlan,
  onGeneratePlans
}) => {
  const { t } = useTranslation();

  // Show skeleton when initially loading or generating plans
  if (generatingPlans && !workoutPlan && !nutritionPlan) {
    return <HomeSkeleton />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div 
        className="flex flex-col md:flex-row justify-between items-start md:items-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('dashboard.welcome')}</h1>
          <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Button 
              className="gradient-primary text-primary-foreground shadow-glow hover-scale" 
              onClick={onGeneratePlans}
              disabled={generatingPlans}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${generatingPlans ? 'animate-spin' : ''}`} />
              {generatingPlans ? t('dashboard.stats.generating') : (workoutPlan || nutritionPlan ? t('dashboard.regenerate.button') : t('dashboard.stats.generatePlans'))}
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div 
        className="grid grid-cols-1 md:grid-cols-4 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, staggerChildren: 0.1 }}
      >
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
          transition={{ duration: 0.2 }}
        >
          <Card className="gradient-card border-primary/20 hover-scale">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('dashboard.stats.currentStreak')}</p>
                  <p className="text-2xl font-bold text-primary">12 {t('dashboard.stats.days')}</p>
                </div>
                <Flame className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
          transition={{ duration: 0.2 }}
        >
          <Card className="gradient-card border-primary/20 hover-scale">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('dashboard.stats.weeklyGoal')}</p>
                  <p className="text-2xl font-bold text-primary">4/5</p>
                </div>
                <Target className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
          transition={{ duration: 0.2 }}
        >
          <Card className="gradient-card border-primary/20 hover-scale">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('dashboard.stats.caloriesBurned')}</p>
                  <p className="text-2xl font-bold text-primary">2,450</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
          transition={{ duration: 0.2 }}
        >
          <Card className="gradient-card border-primary/20 hover-scale">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('dashboard.stats.nextWorkout')}</p>
                  <p className="text-2xl font-bold text-primary">{t('dashboard.stats.today')}</p>
                </div>
                <Clock className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default HomeView;