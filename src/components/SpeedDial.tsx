import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SpeedDialProps {
  onAddExercise: () => void;
  onAutoFill: () => void;
}

export const SpeedDial = ({ onAddExercise, onAutoFill }: SpeedDialProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOpen = () => setIsOpen(!isOpen);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative flex flex-col items-end">
      {/* Speed Dial Actions */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex flex-col gap-2 mb-2"
          >
            {/* Auto-Fill Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: 0.05, duration: 0.15 }}
              onClick={() => handleAction(onAutoFill)}
              className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 flex items-center justify-center shadow-md transition-colors"
              aria-label="AI Auto-Fill Day"
            >
              <Sparkles className="h-4 w-4 text-primary" />
            </motion.button>

            {/* Add Exercise Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: 0.1, duration: 0.15 }}
              onClick={() => handleAction(onAddExercise)}
              className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 flex items-center justify-center shadow-md transition-colors"
              aria-label="Add Exercise"
            >
              <Plus className="h-4 w-4 text-primary" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        onClick={toggleOpen}
        whileTap={{ scale: 0.95 }}
        className="w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl flex items-center justify-center transition-shadow"
        aria-label={isOpen ? "Close actions" : "Open actions"}
      >
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <Plus className="h-5 w-5" />
        </motion.div>
      </motion.button>
    </div>
  );
};
