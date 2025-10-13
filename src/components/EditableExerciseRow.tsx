import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Info, Edit2, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';

interface EditableExerciseRowProps {
  exercise: Exercise;
  exerciseIndex: number;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (updatedExercise: Exercise) => void;
  onCancel: () => void;
  onInfo: () => void;
}

const EditableExerciseRow: React.FC<EditableExerciseRowProps> = ({
  exercise,
  exerciseIndex,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onInfo,
}) => {
  const { t } = useTranslation();
  
  // Local draft state for editing
  const [draft, setDraft] = useState<Exercise>(exercise);

  // Reset draft when switching to edit mode
  React.useEffect(() => {
    if (isEditing) {
      setDraft(exercise);
    }
  }, [isEditing, exercise]);

  const handleSave = () => {
    // Basic validation
    if (!draft.name.trim()) {
      return;
    }
    if (draft.sets < 1) {
      return;
    }
    if (!draft.reps.trim()) {
      return;
    }

    // Ensure sets is a valid number (not NaN or string)
    const sanitizedDraft: Exercise = {
      ...draft,
      sets: typeof draft.sets === 'number' && !isNaN(draft.sets) ? draft.sets : 1,
      name: draft.name.trim(),
      reps: draft.reps.trim(),
      weight: draft.weight?.trim() || undefined,
      rest: draft.rest?.trim() || undefined,
      description: draft.description?.trim() || undefined,
    };

    console.log('[EditableExerciseRow] Saving exercise:', sanitizedDraft);
    onSave(sanitizedDraft);
  };

  // Display mode
  if (!isEditing) {
    // Coerce legacy string sets to numbers for display
    const displaySets = typeof exercise.sets === 'string' ? parseInt(exercise.sets) || exercise.sets : exercise.sets;
    
    return (
      <div className="flex items-center justify-between p-2 bg-background/50 rounded-lg border border-border/50 group hover:border-primary/30 transition-colors">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-foreground">
              {exercise.name}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={onInfo}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              aria-label={`Info für ${exercise.name}`}
            >
              <Info className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="text-sm" aria-hidden="true">🏋️</span>
            <span className="font-medium tabular-nums">
              {displaySets}×{exercise.reps}
            </span>
            <span className="sr-only">
              {t('workout.setsReps', { sets: displaySets, reps: exercise.reps })}
            </span>
          </div>
          {exercise.weight && (
            <div className="flex items-center gap-1">
              <span className="text-sm" aria-hidden="true">⚖️</span>
              <span className="tabular-nums">{exercise.weight}</span>
              <span className="sr-only">Gewicht: {exercise.weight}</span>
            </div>
          )}
          {exercise.rest && (
            <div className="flex items-center gap-1">
              <span className="text-sm" aria-hidden="true">⏱</span>
              <span className="tabular-nums">{exercise.rest}</span>
              <span className="sr-only">Pause: {exercise.rest}</span>
            </div>
          )}
          {exercise.description && exercise.description.includes('km') && (
            <div className="flex items-center gap-1">
              <span className="text-sm" aria-hidden="true">📏</span>
              <span className="tabular-nums">{exercise.description}</span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Edit exercise"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="flex flex-col gap-3 p-3 bg-background/80 rounded-lg border-2 border-primary/50">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-3">
          {/* Exercise Name */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t('workout.exerciseName') || 'Exercise Name'}
            </label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g., Bench Press"
              className="text-sm"
            />
          </div>

          {/* Sets and Reps */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('workout.sets') || 'Sets'}
              </label>
              <Input
                type="number"
                min="1"
                max="20"
                value={draft.sets}
                onChange={(e) => setDraft({ ...draft, sets: parseInt(e.target.value) || 1 })}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('workout.reps') || 'Reps'}
              </label>
              <Input
                value={draft.reps}
                onChange={(e) => setDraft({ ...draft, reps: e.target.value })}
                placeholder="e.g., 8-12"
                className="text-sm"
              />
            </div>
          </div>

          {/* Weight and Rest (optional) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('workout.weight') || 'Weight'} ({t('workout.optional') || 'optional'})
              </label>
              <Input
                value={draft.weight || ''}
                onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                placeholder="e.g., 60kg"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('workout.rest') || 'Rest'} ({t('workout.optional') || 'optional'})
              </label>
              <Input
                value={draft.rest || ''}
                onChange={(e) => setDraft({ ...draft, rest: e.target.value })}
                placeholder="e.g., 90s"
                className="text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-8"
        >
          <X className="h-4 w-4 mr-1" />
          {t('common.cancel') || 'Cancel'}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          className="h-8"
        >
          <Check className="h-4 w-4 mr-1" />
          {t('common.save') || 'Save'}
        </Button>
      </div>
    </div>
  );
};

export default EditableExerciseRow;
