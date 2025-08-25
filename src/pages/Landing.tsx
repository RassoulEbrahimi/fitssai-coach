import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import CTA from "@/components/CTA";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleGetStarted = () => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate('/auth/sign-up');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16"> {/* Account for fixed navbar */}
        <Hero onGetStarted={handleGetStarted} />
        <Features />
        <CTA onGetStarted={handleGetStarted} />
      </div>
    </div>
  );
};

export default Landing;