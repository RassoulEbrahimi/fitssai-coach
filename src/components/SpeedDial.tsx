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
    <div className="absolute bottom-3 right-3 lg:fixed lg:bottom-6 lg:right-6 flex flex-col items-end z-50">
      {/* Speed Dial Actions */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex flex-col gap-2 lg:gap-3 mb-2 lg:mb-3"
          >
            {/* Auto-Fill Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: 0.05, duration: 0.15 }}
              onClick={() => handleAction(onAutoFill)}
              className="group flex items-center gap-2 rounded-full bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 shadow-md hover:shadow-lg transition-all lg:hover:scale-105 w-10 h-10 lg:w-auto lg:h-12 lg:px-4"
              aria-label="AI Auto-Fill Day"
            >
              <Sparkles className="h-4 w-4 lg:h-5 lg:w-5 text-primary flex-shrink-0" />
              <span className="hidden lg:inline-block text-sm font-medium text-primary whitespace-nowrap">
                Auto-Fill Day
              </span>
            </motion.button>

            {/* Add Exercise Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: 0.1, duration: 0.15 }}
              onClick={() => handleAction(onAddExercise)}
              className="group flex items-center gap-2 rounded-full bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 shadow-md hover:shadow-lg transition-all lg:hover:scale-105 w-10 h-10 lg:w-auto lg:h-12 lg:px-4"
              aria-label="Add Exercise"
            >
              <Plus className="h-4 w-4 lg:h-5 lg:w-5 text-primary flex-shrink-0" />
              <span className="hidden lg:inline-block text-sm font-medium text-primary whitespace-nowrap">
                Add Exercise
              </span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        onClick={toggleOpen}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
        className="w-10 h-10 lg:w-14 lg:h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl lg:hover:shadow-2xl flex items-center justify-center transition-all"
        aria-label={isOpen ? "Close actions" : "Open actions"}
      >
        {isOpen ? (
          <X className="h-5 w-5 lg:h-6 lg:w-6" />
        ) : (
          <Plus className="h-5 w-5 lg:h-6 lg:w-6" />
        )}
      </motion.button>
    </div>
  );
};
