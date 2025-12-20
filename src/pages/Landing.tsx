import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleGetStarted = () => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate('/auth/sign-in'); // Changed to sign-in as per requirements
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 selection:bg-primary/30">
      <Navbar variant="landing" />
      <main>
        <Hero onGetStarted={handleGetStarted} />
      </main>
    </div>
  );
};

export default Landing;