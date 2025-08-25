import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import CTA from "@/components/CTA";
import Dashboard from "@/components/Dashboard";
import OnboardingForm from "@/components/OnboardingForm";
import Auth from "@/components/Auth";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { user, loading } = useAuth();
  const [currentView, setCurrentView] = useState<'landing' | 'onboarding' | 'dashboard'>('landing');
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  // Check if user has completed profile
  useEffect(() => {
    if (user) {
      checkUserProfile();
    }
  }, [user]);

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
      
      // If user has profile, go to dashboard
      if (data) {
        setCurrentView('dashboard');
      } else {
        setCurrentView('onboarding');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleGetStarted = () => {
    if (user) {
      setCurrentView('onboarding');
    } else {
      setCurrentView('landing'); // This will show auth
    }
  };

  const handleOnboardingComplete = () => {
    setHasProfile(true);
    setCurrentView('dashboard');
  };

  const handleAuthSuccess = () => {
    // Will trigger useEffect to check profile
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  // Show auth if no user
  if (!user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'onboarding':
        return <OnboardingForm onComplete={handleOnboardingComplete} />;
      case 'dashboard':
        return <Dashboard />;
      default:
        return (
          <>
            <Navigation onGetStarted={handleGetStarted} />
            <Hero onGetStarted={handleGetStarted} />
            <Features />
            <CTA onGetStarted={handleGetStarted} />
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {renderCurrentView()}
    </div>
  );
};

export default Index;