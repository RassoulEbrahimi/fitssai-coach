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
              className="flex items-center justify-center rounded-full bg-card/80 backdrop-blur shadow ring-1 ring-border/50 hover:bg-card hover:shadow-md transition-all hover:scale-105 active:scale-95 w-7 h-7 lg:w-8 lg:h-8"
              aria-label="Automatisch ausfüllen"
            >
              <Sparkles className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-primary flex-shrink-0" />
            </motion.button>

            {/* Add Exercise Button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.14 }}
              onClick={() => handleAction(onAddExercise)}
              className="flex items-center justify-center rounded-full bg-card/80 backdrop-blur shadow ring-1 ring-border/50 hover:bg-card hover:shadow-md transition-all hover:scale-105 active:scale-95 w-7 h-7 lg:w-8 lg:h-8"
              aria-label="Übung hinzufügen"
            >
              <Plus className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-primary flex-shrink-0" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        onClick={toggleOpen}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
        className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg flex items-center justify-center transition-all active:scale-95"
        aria-label={isOpen ? "Schließen" : "Aktionen öffnen"}
      >
        {isOpen ? (
          <X className="h-4 w-4 lg:h-[1.125rem] lg:w-[1.125rem]" />
        ) : (
          <Plus className="h-4 w-4 lg:h-[1.125rem] lg:w-[1.125rem]" />
        )}
      </motion.button>
    </div>
  );
};
