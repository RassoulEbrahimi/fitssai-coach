import React from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import InlineEditableExercise from "@/components/InlineEditableExercise";
import type { Exercise } from "@/hooks/useExerciseEditor";
import { motion, AnimatePresence } from "framer-motion";

const MemoizedInlineEditableExercise = React.memo(InlineEditableExercise, (prev, next) => {
  return (
    prev.exercise === next.exercise &&
    prev.exerciseIndex === next.exerciseIndex &&
    prev.isUpdating === next.isUpdating
  );
});

interface ExerciseListProps {
  exercises: any[];
  // Inline editing support
  onUpdateExercise?: (exerciseIndex: number, exercise: Exercise) => Promise<void>;
  isUpdating?: boolean;
}

const ExerciseList: React.FC<ExerciseListProps> = ({ 
  exercises,
  onUpdateExercise,
  isUpdating = false,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const handleExerciseInfo = () => {
    toast({
      title: t('workout.infoSoon'),
      description: "",
    });
  };

  if (!exercises || exercises.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-muted-foreground text-sm">
          {t('workout.noExercises')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 lg:space-y-3 list-none" role="list">
      <AnimatePresence initial={false} mode="popLayout">
        {exercises.map((exercise: any, exerciseIndex: number) => {
          // Use inline editable component if update handler is provided
          if (onUpdateExercise) {
            return (
              <motion.li 
                key={exerciseIndex}
                initial={{ opacity: 0, y: 8, scale: 1 }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  scale: [1, 1, 1.02, 1],
                  filter: [
                    "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                    "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                    "drop-shadow(0 0 12px rgba(0, 255, 156, 0.3))",
                    "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                  ]
                }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ 
                  opacity: { duration: 0.3, ease: "easeOut" },
                  y: { duration: 0.3, ease: "easeOut" },
                  scale: { duration: 0.5, delay: 0.3, ease: "easeOut", times: [0, 0, 0.5, 1] },
                  filter: { duration: 0.5, delay: 0.3, ease: "easeOut", times: [0, 0, 0.5, 1] }
                }}
                layout
              >
                <MemoizedInlineEditableExercise
                  exercise={exercise}
                  exerciseIndex={exerciseIndex}
                  onUpdate={(updatedExercise) => onUpdateExercise(exerciseIndex, updatedExercise)}
                  onInfo={handleExerciseInfo}
                  isUpdating={isUpdating}
                />
              </motion.li>
            );
          }

          // Fallback to read-only display
          return (
            <motion.li 
              key={exerciseIndex}
              initial={{ opacity: 0, y: 8, scale: 1 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                scale: [1, 1, 1.02, 1],
                filter: [
                  "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                  "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                  "drop-shadow(0 0 12px rgba(0, 255, 156, 0.3))",
                  "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                ]
              }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ 
                opacity: { duration: 0.3, ease: "easeOut" },
                y: { duration: 0.3, ease: "easeOut" },
                scale: { duration: 0.5, delay: 0.3, ease: "easeOut", times: [0, 0, 0.5, 1] },
                filter: { duration: 0.5, delay: 0.3, ease: "easeOut", times: [0, 0, 0.5, 1] }
              }}
              layout
            >
              <div className="flex items-center justify-between p-1.5 sm:p-2 md:p-3 bg-background/50 rounded-lg border border-border/50">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                  <h4 className="font-medium text-foreground text-sm sm:text-sm md:text-base truncate">
                    {exercise.name}
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExerciseInfo}
                    className="h-5 w-5 sm:h-6 sm:w-6 p-0 text-muted-foreground hover:text-foreground flex-shrink-0"
                    aria-label={`Info für ${exercise.name}`}
                  >
                    <Info className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 text-xs sm:text-xs md:text-sm text-muted-foreground flex-shrink-0 ml-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm md:text-base" aria-hidden="true">🏋️</span>
                    <span className="font-medium tabular-nums">
                      {exercise.sets}×{exercise.reps}
                    </span>
                    <span className="sr-only">
                      {t('workout.setsReps', { sets: exercise.sets, reps: exercise.reps })}
                    </span>
                  </div>
                  {exercise.weight && (
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <span className="text-sm md:text-base" aria-hidden="true">⚖️</span>
                      <span className="tabular-nums">{exercise.weight}</span>
                      <span className="sr-only">Gewicht: {exercise.weight}</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
};

export default ExerciseList;