import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

export default function EmeraldSplash({ onFinish }: { onFinish: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onFinish, 400);
    }, 1200);
    return () => clearTimeout(timer);
  }, [onFinish]);

  // Respect prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: prefersReducedMotion ? 1 : [0, 1, 1, 0],
            scale: prefersReducedMotion ? 1 : [0.95, 1.05, 1, 1],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.3 : 1.2, ease: "easeInOut" }}
          className="fixed inset-0 flex items-center justify-center bg-background z-50"
        >
          <motion.div
            className="flex flex-col items-center justify-center text-center"
            initial={{ scale: prefersReducedMotion ? 1 : 0.9 }}
            animate={{ 
              scale: 1, 
              opacity: 1,
              filter: prefersReducedMotion 
                ? "drop-shadow(0 0 10px rgba(16,185,129,0.4))"
                : [
                    "drop-shadow(0 0 0px rgba(16,185,129,0))",
                    "drop-shadow(0 0 18px rgba(16,185,129,0.6))",
                    "drop-shadow(0 0 12px rgba(16,185,129,0.4))",
                    "drop-shadow(0 0 0px rgba(16,185,129,0))",
                  ]
            }}
            transition={{ duration: prefersReducedMotion ? 0.3 : 1.2 }}
          >
            <img
              src="/icons/fitssai-512.png"
              alt="FitssAI"
              className="w-24 h-24 rounded-2xl"
            />
            <motion.p
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: [0.6, 1, 0.8] }
              }
              transition={{
                duration: prefersReducedMotion ? 0 : 1.5,
                repeat: prefersReducedMotion ? 0 : Infinity,
                ease: "easeInOut",
              }}
              className="text-primary font-semibold text-lg mt-4"
            >
              FitssAI wird geladen…
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
