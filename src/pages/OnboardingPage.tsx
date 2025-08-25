import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate } from "react-router-dom";
import OnboardingForm from "@/components/OnboardingForm";
import Navbar from "@/components/Navbar";

const OnboardingPage = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const handleOnboardingComplete = () => {
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <OnboardingForm onComplete={handleOnboardingComplete} />
      </div>
    </div>
  );
};

export default OnboardingPage;