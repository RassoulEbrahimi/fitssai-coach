import React from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import type { Exercise } from "@/hooks/useExerciseEditor";

interface ExerciseCardProps {
    exercise: Exercise;
    exerciseIndex: number; // For keys/ids
    onInfo: () => void;
}

export const ExerciseCard: React.FC<ExerciseCardProps> = ({
    exercise,
    onInfo
}) => {
    const { t } = useTranslation();

    return (
        <div className="flex items-center justify-between p-1.5 sm:p-2 md:p-3 bg-background/50 rounded-lg border border-border/50">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                <h4 className="font-medium text-foreground text-sm sm:text-sm md:text-base truncate">
                    {exercise.name}
                </h4>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onInfo}
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
    );
};

// Also define the animation variants here for reusability if needed, 
// though layout animations are usually handled by the parent list.
export const exerciseCardVariants = {
    hidden: { opacity: 0, scale: 0.95, filter: "blur(2px)" },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        filter: [
            "blur(0px) drop-shadow(0 0 0px rgba(16, 185, 129, 0))",
            "blur(0px) drop-shadow(0 0 10px rgba(16, 185, 129, 0.3))",
            "blur(0px) drop-shadow(0 0 0px rgba(16, 185, 129, 0))"
        ]
    },
    exit: { opacity: 0, scale: 0.9, filter: "blur(1px)" }
};
