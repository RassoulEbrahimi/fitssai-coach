import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export const FarewellPage: React.FC = () => {
  const [showContent, setShowContent] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Optional: Auto-redirect after 5 seconds if user doesn't click
  useEffect(() => {
    const autoRedirect = setTimeout(() => {
      handleRestart();
    }, 5000);

    return () => clearTimeout(autoRedirect);
  }, []);

  // Play optional farewell chime
  useEffect(() => {
    try {
      const audio = new Audio("/audio/farewell-chime.mp3");
      audio.volume = 0.2;
      audio.play().catch(() => {
        // Audio is optional
      });
    } catch (e) {
      // Continue without audio
    }
  }, []);

  const handleRestart = () => {
    setShowContent(false);
    setTimeout(() => {
      navigate("/auth/sign-up");
    }, 600);
  };

  return (
    <AnimatePresence>
      {showContent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
        >
          {/* Blurred Glass Background */}
          <div className="absolute inset-0 bg-background/95 backdrop-blur-xl" />
          
          {/* Animated Gradient Overlay */}
          <motion.div
            animate={{
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-rose-500/20 to-emerald-700/20"
          />

          {/* Breathing Glow Effect */}
          <motion.div
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.4, 0.6, 0.4],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute w-96 h-96 rounded-full bg-gradient-to-r from-emerald-500/30 via-rose-500/30 to-emerald-600/30 blur-3xl"
          />

          {/* Main Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8 }}
            className="relative z-10 text-center px-6 max-w-2xl"
          >
            {/* Header */}
            <motion.h1
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="text-4xl md:text-5xl font-bold mb-6 bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500 bg-clip-text text-transparent"
            >
              🌿 Konto gelöscht
            </motion.h1>

            {/* Subtext */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.8 }}
              className="text-xl md:text-2xl text-muted-foreground/80 mb-12 leading-relaxed space-y-2"
            >
              <p>Danke, dass du Teil unserer Community warst.</p>
              <p>Manchmal ist ein Neuanfang alles, was wir brauchen. 🌅</p>
            </motion.div>

            {/* Restart Button */}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2, duration: 0.6 }}
              onClick={handleRestart}
              className="group relative px-8 py-4 rounded-full bg-gradient-to-r from-emerald-600/30 via-rose-500/25 to-emerald-700/30 backdrop-blur-xl border border-emerald-500/40 text-emerald-300 font-semibold text-lg flex items-center justify-center gap-3 mx-auto overflow-hidden"
              whileHover={{ 
                scale: 1.05,
                boxShadow: "0 0 30px rgba(16, 185, 129, 0.5)"
              }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Animated gradient border glow */}
              <motion.div
                className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: "linear-gradient(90deg, rgba(16, 185, 129, 0.5), rgba(244, 63, 94, 0.5), rgba(16, 185, 129, 0.5))",
                  backgroundSize: "200% 100%",
                }}
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "linear"
                }}
              />
              
              {/* Button content */}
              <span className="relative z-10">Neu anfangen</span>
              <ArrowRight className="relative z-10 w-5 h-5 group-hover:translate-x-1 transition-transform" />

              {/* Pulsating glow background */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 blur-xl"
                animate={{
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
            </motion.button>

            {/* Subtle hint text */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.8, duration: 0.8 }}
              className="mt-8 text-sm text-muted-foreground/50"
            >
              Du wirst automatisch weitergeleitet...
            </motion.p>
          </motion.div>

          {/* Floating particles effect */}
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 rounded-full bg-emerald-400/30"
              initial={{
                x: Math.random() * window.innerWidth,
                y: window.innerHeight + 20,
              }}
              animate={{
                y: -20,
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 4 + Math.random() * 3,
                repeat: Infinity,
                delay: i * 0.8,
                ease: "easeOut"
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
