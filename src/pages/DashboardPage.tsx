import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import Dashboard from "@/components/Dashboard";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
const DashboardPage = () => {
  const {
    user,
    loading
  } = useAuth();
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  useEffect(() => {
    if (user) {
      checkUserProfile();
    }
  }, [user]);
  const checkUserProfile = async () => {
    if (!user) return;
    try {
      const {
        data,
        error
      } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
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
  if (loading || checkingProfile) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>;
  }
  if (!user) {
    return <Navigate to="/auth/sign-in" replace />;
  }
  if (hasProfile === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16 px-0 mx-0 my-0 rounded-none py-[30px]">
        <Dashboard />
      </div>
    </div>;
};
export default DashboardPage;