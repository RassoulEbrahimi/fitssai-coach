import { useAuth } from "@/hooks/useAuth";
import { Navigate, useLocation } from "react-router-dom";
import Dashboard from "@/components/Dashboard";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { useState, useEffect, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useFocusMode } from "@/contexts/FocusModeContext";

const DashboardPage = () => {
  const { user, loading } = useAuth();
  const { isFocusMode } = useFocusMode();
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Reset scroll logic moved to global ScrollToTop component

  useEffect(() => {
    const checkUserProfile = async () => {
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setHasProfile(snap.exists());
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

  // Unblock render: render layout immediately, handle redirect as side effect
  if (loading) {
    // Only block purely on generic auth loading if absolutely necessary, 
    // but usually useAuth resolves quickly. 
    // If we want total instant shell, we might even skip this, but 'user' is needed below.
    return (
      <div className="flex flex-col min-h-[100dvh] w-full bg-background overflow-x-hidden">
        {/* Minimal shell or skeleton could go here, for now keeping checking logic minimal */}
        <div className="min-h-screen bg-background flex items-center justify-center">
          {/* Short spinner is okay for auth, but profile check (below) should not block */}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  // If we definitely know they have no profile, redirect
  // But while checking (hasProfile === null/true), we show the Dashboard
  if (hasProfile === false) {
    return <Navigate to="/onboarding" replace />;
  }

  // Render Dashboard immediately even if checkingProfile is true

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-transparent overflow-x-hidden">
      <main
        ref={mainRef}
        id="app-scroll"
        className="flex-1 pb-[calc(var(--bottom-nav-offset)+env(safe-area-inset-bottom))]"
      >
        <WorkoutErrorBoundary>
          <Dashboard />
        </WorkoutErrorBoundary>
      </main>
    </div>
  );
};
export default DashboardPage;
