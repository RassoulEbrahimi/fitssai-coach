import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import Dashboard from "@/components/Dashboard";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useFocusMode } from "@/contexts/FocusModeContext";

const DashboardPage = () => {
  const { user, loading } = useAuth();
  const { isFocusMode } = useFocusMode();
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);

  useEffect(() => {
    const checkUserProfile = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (error) {
          console.error('Error checking profile:', error);
          return;
        }
        setHasProfile(!!data);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setCheckingProfile(false);
      }
    };

    if (user) {
      checkUserProfile();
    }
  }, [user]);

  if (loading || checkingProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/auth/sign-in" replace />;
  }
  if (hasProfile === false) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-background overflow-hidden">
      <main className="flex-1 overflow-y-auto overscroll-contain pb-safe-or-4">
        <WorkoutErrorBoundary>
          <Dashboard />
        </WorkoutErrorBoundary>
      </main>
    </div>
  );
};
export default DashboardPage;