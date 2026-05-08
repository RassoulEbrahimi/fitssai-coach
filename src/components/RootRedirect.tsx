import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import Landing from "@/pages/Landing";
import EmeraldSplash from "@/components/EmeraldSplash";

const RootRedirect = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [shouldShowLanding, setShouldShowLanding] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const handleRedirect = async () => {
      if (authLoading) return;
      if (!user) { setShouldShowLanding(true); return; }

      setCheckingProfile(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          navigate("/onboarding", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } catch (error) {
        console.error("Profile check error:", error);
        navigate("/dashboard", { replace: true });
      } finally {
        setCheckingProfile(false);
      }
    };

    handleRedirect();
  }, [user, authLoading, navigate]);

  if (showSplash) return <EmeraldSplash onFinish={() => setShowSplash(false)} />;
  if (shouldShowLanding) return <Landing />;

  const isLoading = authLoading || checkingProfile;
  if (!isLoading) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="min-h-screen bg-background flex flex-col items-center justify-center">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} className="flex flex-col items-center gap-6">
        <motion.div animate={{ opacity: [1, 0.5, 1], scale: [1, 1.05, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} className="relative" style={{ filter: "drop-shadow(0 0 20px hsl(var(--primary) / 0.3))" }}>
          <Loader2 className="h-16 w-16 text-primary animate-spin" />
        </motion.div>
        <motion.p animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} className="text-lg font-medium text-muted-foreground">
          FitssAI wird geladen…
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

export default RootRedirect;
