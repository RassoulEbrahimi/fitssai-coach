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
    <div className="space-y-3">
      {exercises.map((exercise: any, exerciseIndex: number) => {
        const isEditing = editingExercise?.exerciseIndex === exerciseIndex;

        if (supportsEditing) {
          return (
            <MemoizedEditableExerciseRow
              key={exerciseIndex}
              exercise={exercise}
              exerciseIndex={exerciseIndex}
              isEditing={isEditing}
              onEdit={() => onEditExercise(exerciseIndex)}
              onSave={(updatedExercise) => onSaveExercise(exerciseIndex, updatedExercise)}
              onCancel={onCancelEdit}
              onInfo={handleExerciseInfo}
            />
          );
        }

        // Fallback to read-only display
        return (
          <div
            key={exerciseIndex}
            className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">
                  {exercise.name}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExerciseInfo}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Info für ${exercise.name}`}
                >
                  <Info className="h-3 w-3" />
                </Button>
              </div>
              {exercise.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {exercise.description}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-foreground">
                {exercise.sets} × {exercise.reps}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('workout.setsReps', { sets: exercise.sets, reps: exercise.reps })}
              </div>
              {exercise.weight && (
                <div className="text-xs text-muted-foreground">
                  {exercise.weight}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExerciseList;