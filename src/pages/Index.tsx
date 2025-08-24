import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import CTA from "@/components/CTA";
import Dashboard from "@/components/Dashboard";
import OnboardingForm from "@/components/OnboardingForm";
import { useState } from "react";

const Index = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'onboarding' | 'dashboard'>('landing');

  const handleGetStarted = () => {
    setCurrentView('onboarding');
  };

  const handleOnboardingComplete = () => {
    setCurrentView('dashboard');
  };

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
