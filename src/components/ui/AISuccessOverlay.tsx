import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

export function AISuccessOverlay({ visible, onFinish }: { visible: boolean; onFinish: () => void }) {
  const [show, setShow] = useState(visible);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onFinish();
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [visible, onFinish]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{
              scale: prefersReducedMotion ? 1 : [1, 1.15, 1],
              opacity: 1,
              filter: prefersReducedMotion 
                ? "drop-shadow(0 0 20px #10b981)" 
                : ["drop-shadow(0 0 10px #10b981)", "drop-shadow(0 0 30px #10b981)", "drop-shadow(0 0 20px #10b981)"],
            }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="text-5xl font-bold text-emerald-400"
          >
            FitssAI
          </motion.div>

          <motion.p
            className="mt-4 text-xl text-emerald-200"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            Tagesplan erfolgreich übernommen 💪
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
