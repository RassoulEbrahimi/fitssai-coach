import React from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import EditableExerciseRow from "@/components/EditableExerciseRow";
import type { Exercise } from "@/hooks/useExerciseEditor";

const MemoizedEditableExerciseRow = React.memo(EditableExerciseRow, (prev, next) => {
  return (
    prev.exercise === next.exercise &&
    prev.isEditing === next.isEditing &&
    prev.exerciseIndex === next.exerciseIndex
  );
});

interface ExerciseListProps {
  exercises: any[];
  // Optional editing support
  editingExercise?: { exerciseIndex: number; draft: Exercise } | null;
  onEditExercise?: (exerciseIndex: number) => void;
  onSaveExercise?: (exerciseIndex: number, exercise: Exercise) => void;
  onCancelEdit?: () => void;
}

const ExerciseList: React.FC<ExerciseListProps> = ({ 
  exercises,
  editingExercise,
  onEditExercise,
  onSaveExercise,
  onCancelEdit,
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

  // Use EditableExerciseRow if editing props are provided
  const supportsEditing = !!(onEditExercise && onSaveExercise && onCancelEdit);

  return (
    <ul className="space-y-2 list-none" role="list">
      {exercises.map((exercise: any, exerciseIndex: number) => {
        const isEditing = editingExercise?.exerciseIndex === exerciseIndex;

        if (supportsEditing) {
          return (
            <li key={exerciseIndex}>
              <MemoizedEditableExerciseRow
                exercise={exercise}
                exerciseIndex={exerciseIndex}
                isEditing={isEditing}
                onEdit={() => onEditExercise(exerciseIndex)}
                onSave={(updatedExercise) => onSaveExercise(exerciseIndex, updatedExercise)}
                onCancel={onCancelEdit}
                onInfo={handleExerciseInfo}
              />
            </li>
          );
        }

        // Fallback to read-only display
        return (
          <li key={exerciseIndex}>
            <div className="flex items-center justify-between p-2 bg-background/50 rounded-lg border border-border/50">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground text-sm">
                  {exercise.name}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExerciseInfo}
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Info für ${exercise.name}`}
                >
                  <Info className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span className="text-sm" aria-hidden="true">🏋️</span>
                  <span className="font-medium tabular-nums">
                    {exercise.sets}×{exercise.reps}
                  </span>
                  <span className="sr-only">
                    {t('workout.setsReps', { sets: exercise.sets, reps: exercise.reps })}
                  </span>
                </div>
                {exercise.weight && (
                  <div className="flex items-center gap-1">
                    <span className="text-sm" aria-hidden="true">⚖️</span>
                    <span className="tabular-nums">{exercise.weight}</span>
                    <span className="sr-only">Gewicht: {exercise.weight}</span>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default ExerciseList;