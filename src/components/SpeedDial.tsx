import { useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
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
    <div className="absolute bottom-3 right-3 lg:bottom-4 lg:right-4 z-20 flex flex-col items-center gap-2">
      {/* Speed Dial Actions */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex flex-col gap-2 origin-bottom fab-anim"
          >
            {/* Auto-Fill Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: 0.05, duration: 0.15 }}
              onClick={() => handleAction(onAutoFill)}
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-md hover:brightness-110 dark:opacity-90 flex items-center justify-center transition-transform transition-opacity duration-150 fab-anim"
              aria-label="Auto-Fill"
            >
              <Sparkles className="h-4 w-4 flex-shrink-0" />
            </motion.button>

            {/* Add Exercise Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: 0.1, duration: 0.15 }}
              onClick={() => handleAction(onAddExercise)}
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-md hover:brightness-110 dark:opacity-90 flex items-center justify-center transition-transform transition-opacity duration-150 fab-anim"
              aria-label="Add Exercise"
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        onClick={toggleOpen}
        whileTap={{ scale: 0.95 }}
        className="w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-md hover:brightness-110 dark:opacity-90 flex items-center justify-center transition-transform transition-opacity duration-150 fab-anim text-xl"
        aria-label={isOpen ? "Close" : "Open actions"}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Plus className="h-5 w-5" />
        )}
      </motion.button>
    </div>
  );
};
