import { useAuth } from "@/hooks/useAuth";
import { Navigate, useLocation } from "react-router-dom";
import Dashboard from "@/components/Dashboard";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useFocusMode } from "@/contexts/FocusModeContext";

const DashboardPage = () => {
  const { user, loading } = useAuth();
  const { isFocusMode } = useFocusMode();
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Reset scroll on route/tab change
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [location.pathname, location.hash]);

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
    <div className="flex flex-col min-h-[100dvh] w-full bg-background overflow-x-hidden">
      <main
        ref={mainRef}
        id="app-scroll"
        className="flex-1 overflow-y-auto overscroll-contain pb-[calc(96px+env(safe-area-inset-bottom))]"
      >
        <WorkoutErrorBoundary>
          <Dashboard />
        </WorkoutErrorBoundary>
      </main>
    </div>
  );
};
export default DashboardPage;