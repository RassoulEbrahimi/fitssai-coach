import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ProfileCard } from "@/components/ProfileCard";
import { LogoutButton } from "@/components/LogoutButton";

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
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="profile-content"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="px-4 md:px-6 space-y-6"
      >
        <ProfileCard 
          profile={profile}
          onProfileUpdate={onProfileUpdate}
          workoutProgress={workoutProgress}
        />
        
        {/* Generate Plans Button */}
        {onGeneratePlans && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <Button 
              className="w-full bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200" 
              onClick={onGeneratePlans}
              disabled={generatingPlans}
              size="lg"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${generatingPlans ? 'animate-spin' : ''}`} />
              {generatingPlans ? "Pläne werden erstellt..." : (workoutPlan || nutritionPlan ? "Pläne neu generieren" : "Neue Pläne erstellen")}
            </Button>
          </motion.div>
        )}
        
        {/* Logout Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <LogoutButton />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

ProfileView.displayName = 'ProfileView';

export default ProfileView;