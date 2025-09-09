import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ProfileCard } from "@/components/ProfileCard";

interface ProfileViewProps {
  profile: any;
  onProfileUpdate: () => void;
  workoutProgress: { completed: number; total: number };
}

const ProfileView: React.FC<ProfileViewProps> = React.memo(({ 
  profile, 
  onProfileUpdate, 
  workoutProgress 
}) => {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="profile-content"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
      >
        <ProfileCard 
          profile={profile}
          onProfileUpdate={onProfileUpdate}
          workoutProgress={workoutProgress}
        />
      </motion.div>
    </AnimatePresence>
  );
});

ProfileView.displayName = 'ProfileView';

export default ProfileView;