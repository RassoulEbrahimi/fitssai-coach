import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExerciseSetRowProps {
  setNumber: number;
  targetReps: number | string;
  targetWeight?: string;
  isCompleted: boolean;
  isToggling: boolean;
  onToggle: () => void;
}

export const ExerciseSetRow: React.FC<ExerciseSetRowProps> = ({
  setNumber,
  targetReps,
  targetWeight,
  isCompleted,
  isToggling,
  onToggle,
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.15, delay: setNumber * 0.05 }}
      onClick={onToggle}
      className={cn(
        "flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150",
        "hover:bg-muted/60 active:scale-[0.98]",
        isCompleted 
          ? "bg-primary/10 border border-primary/20" 
          : "bg-muted/30 border border-transparent",
        isToggling && "opacity-60 pointer-events-none"
      )}
      role="checkbox"
      aria-checked={isCompleted}
      aria-label={`Satz ${setNumber}: ${targetReps} Wiederholungen${targetWeight ? ` × ${targetWeight}` : ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-center gap-3">
        {/* Set number badge */}
        <span className={cn(
          "text-xs font-medium w-14",
          isCompleted ? "text-primary" : "text-muted-foreground"
        )}>
          {setNumber}. Satz
        </span>
        
        {/* Target reps and weight */}
        <span className={cn(
          "text-sm font-medium",
          isCompleted ? "text-foreground" : "text-muted-foreground"
        )}>
          {targetReps} {targetWeight ? `× ${targetWeight}` : 'Reps'}
        </span>
      </div>

      {/* Checkbox indicator */}
      <motion.div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
          isCompleted
            ? "bg-primary"
            : "border-2 border-muted-foreground/30 bg-transparent"
        )}
        initial={false}
        animate={{
          scale: isCompleted ? [1, 1.15, 1] : 1,
        }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <AnimatePresence mode="wait">
          {isCompleted && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Check className="h-3.5 w-3.5 text-primary-foreground" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

export default ExerciseSetRow;
