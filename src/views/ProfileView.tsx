import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { RefreshCw, Sparkles } from "lucide-react";
import { ProfileCard } from "@/components/ProfileCard";
import { AIAnalyticsCard } from "@/components/AIAnalyticsCard";
import { LogoutButton } from "@/components/LogoutButton";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePreferences } from "@/contexts/PreferencesContext";

interface ProfileViewProps {
  profile: any;
  onProfileUpdate: () => void;
  workoutProgress: { completed: number; total: number };
  generatingPlans?: boolean;
  workoutPlan?: any;
  nutritionPlan?: any;
  onGeneratePlans?: () => void;
}

const ProfileView: React.FC<ProfileViewProps> = React.memo(({ 
  profile, 
  onProfileUpdate, 
  workoutProgress,
  generatingPlans = false,
  workoutPlan,
  nutritionPlan,
  onGeneratePlans
}) => {
  const { enableAdvancedGlass, setEnableAdvancedGlass } = usePreferences();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="profile-content"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        <ProfileCard 
          profile={profile}
          onProfileUpdate={onProfileUpdate}
          workoutProgress={workoutProgress}
        />

        {/* Advanced Glass Preference Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-primary" />
                Premium Liquid Glass Navigation
              </CardTitle>
              <CardDescription className="text-sm">
                Enable advanced shimmer effects and dynamic color tints for the bottom navigation bar. 
                When disabled, a simpler frosted glass design is used for better focus and battery life.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <Label htmlFor="advanced-glass-toggle" className="text-sm font-medium cursor-pointer">
                  {enableAdvancedGlass ? 'Premium effects enabled' : 'Simple glass design'}
                </Label>
                <Switch
                  id="advanced-glass-toggle"
                  checked={enableAdvancedGlass}
                  onCheckedChange={setEnableAdvancedGlass}
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        {/* AI Analytics Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-8"
        >
          <AIAnalyticsCard />
        </motion.div>
        
        {/* Generate Plans Button */}
        {onGeneratePlans && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-8"
          >
            <Button 
              className="w-full py-6 text-lg rounded-2xl gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-xl transition-all flex items-center justify-center gap-2" 
              onClick={onGeneratePlans}
              disabled={generatingPlans}
            >
              <RefreshCw className={`w-5 h-5 ${generatingPlans ? 'animate-spin' : ''}`} />
              {generatingPlans ? "Pläne werden erstellt..." : (workoutPlan || nutritionPlan ? "Pläne neu generieren" : "Neue Pläne erstellen")}
            </Button>
          </motion.div>
        )}
        
        {/* Logout Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-6"
        >
          <LogoutButton />
        </motion.div>
        
        {/* Delete Account Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="mt-3"
        >
          <DeleteAccountButton />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

ProfileView.displayName = 'ProfileView';

export default ProfileView;