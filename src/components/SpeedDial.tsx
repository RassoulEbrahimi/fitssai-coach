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
    <div className="absolute bottom-3 right-3 flex flex-col items-end pointer-events-auto z-50">
      {/* Speed Dial Actions */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="flex flex-col gap-1.5 mb-2"
          >
            {/* Auto-Fill Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.14 }}
              onClick={() => handleAction(onAutoFill)}
              className="flex items-center justify-center rounded-full bg-card/80 backdrop-blur shadow ring-1 ring-border/50 hover:bg-card hover:shadow-md transition-all hover:scale-105 active:scale-95 w-9 h-9 lg:w-10 lg:h-10"
              aria-label="Auto-Fill"
            >
              <Sparkles className="h-4 w-4 lg:h-[1.125rem] lg:w-[1.125rem] text-primary flex-shrink-0" />
            </motion.button>

            {/* Add Exercise Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.14 }}
              onClick={() => handleAction(onAddExercise)}
              className="flex items-center justify-center rounded-full bg-card/80 backdrop-blur shadow ring-1 ring-border/50 hover:bg-card hover:shadow-md transition-all hover:scale-105 active:scale-95 w-9 h-9 lg:w-10 lg:h-10"
              aria-label="Add Exercise"
            >
              <Plus className="h-4 w-4 lg:h-[1.125rem] lg:w-[1.125rem] text-primary flex-shrink-0" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        onClick={toggleOpen}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
        className="w-11 h-11 lg:w-12 lg:h-12 rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg flex items-center justify-center transition-all active:scale-95"
        aria-label={isOpen ? "Close" : "Open actions"}
      >
        {isOpen ? (
          <X className="h-[1.125rem] w-[1.125rem] lg:h-5 lg:w-5" />
        ) : (
          <Plus className="h-[1.125rem] w-[1.125rem] lg:h-5 lg:w-5" />
        )}
      </motion.button>
    </div>
  );
};
