import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';
import { cn } from '@/lib/utils';

interface InlineEditableExerciseProps {
  exercise: Exercise;
  exerciseIndex: number;
  onUpdate: (updatedExercise: Exercise) => Promise<void>;
  onInfo: () => void;
  isUpdating?: boolean;
}

const InlineEditableExercise: React.FC<InlineEditableExerciseProps> = ({
  exercise,
  exerciseIndex,
  onUpdate,
  onInfo,
  isUpdating = false,
}) => {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  
  // Local state for inputs (for immediate UI updates)
  const [localWeight, setLocalWeight] = useState(exercise.weight || '');
  const [localRest, setLocalRest] = useState(exercise.rest || '');
  const [localDescription, setLocalDescription] = useState(exercise.description || '');

  // Sync local state when exercise prop changes
  React.useEffect(() => {
    setLocalWeight(exercise.weight || '');
    setLocalRest(exercise.rest || '');
    setLocalDescription(exercise.description || '');
  }, [exercise.weight, exercise.rest, exercise.description]);

  // Detect if cardio exercise (has distance in description or no sets/reps)
  const isCardio = exercise.description?.toLowerCase().includes('km') || 
                    exercise.description?.toLowerCase().includes('min');

  const handleFieldUpdate = async (field: keyof Exercise, value: any) => {
    setIsSaving(true);
    try {
      await onUpdate({
        ...exercise,
        [field]: value,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetsChange = (value: string) => {
    handleFieldUpdate('sets', parseInt(value));
  };

  const handleRepsChange = (value: string) => {
    handleFieldUpdate('reps', value);
  };

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalWeight(e.target.value);
  };

  const handleWeightBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== exercise.weight) {
      handleFieldUpdate('weight', value);
    }
  };

  const handleRestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalRest(e.target.value);
  };

  const handleRestBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== exercise.rest) {
      handleFieldUpdate('rest', value);
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalDescription(e.target.value);
  };

  const handleDescriptionBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== exercise.description) {
      handleFieldUpdate('description', value);
    }
  };

  return (
    <div className={cn(
      "flex flex-col gap-2 p-1.5 sm:p-2 md:p-3 bg-background/50 rounded-lg border border-border/50",
      "hover:border-primary/30 transition-colors",
      (isSaving || isUpdating) && "opacity-60 pointer-events-none"
    )}>
      {/* Header: Exercise name + info button + loading indicator */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <h4 className="font-medium text-foreground text-sm sm:text-sm md:text-base flex-1 min-w-0 truncate">
          {exercise.name}
        </h4>
        {(isSaving || isUpdating) && (
          <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin text-primary flex-shrink-0" />
        )}
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

      {/* Editable fields */}
      {!isCardio ? (
        // Strength exercise fields
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 flex-wrap">
          {/* Sets dropdown */}
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">🏋️</span>
            <Select
              value={String(exercise.sets)}
              onValueChange={handleSetsChange}
              disabled={isSaving || isUpdating}
            >
              <SelectTrigger className="h-7 w-14 sm:h-8 sm:w-16 text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border z-50 shadow-lg">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                  <SelectItem 
                    key={num} 
                    value={String(num)}
                    className="hover:bg-accent focus:bg-accent"
                  >
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reps dropdown */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">×</span>
            <Select
              value={String(exercise.reps)}
              onValueChange={handleRepsChange}
              disabled={isSaving || isUpdating}
            >
              <SelectTrigger className="h-7 w-14 sm:h-8 sm:w-16 text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border z-50 shadow-lg">
                {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                  <SelectItem 
                    key={num} 
                    value={String(num)}
                    className="hover:bg-accent focus:bg-accent"
                  >
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Weight input */}
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">⚖️</span>
            <Input
              type="text"
              value={localWeight}
              onChange={handleWeightChange}
              onBlur={handleWeightBlur}
              placeholder="kg"
              disabled={isSaving || isUpdating}
              className="h-7 w-16 sm:h-8 sm:w-20 text-xs sm:text-sm px-2"
            />
          </div>

          {/* Rest input */}
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">⏱</span>
            <Input
              type="text"
              value={localRest}
              onChange={handleRestChange}
              onBlur={handleRestBlur}
              placeholder="90s"
              disabled={isSaving || isUpdating}
              className="h-7 w-16 sm:h-8 sm:w-20 text-xs sm:text-sm px-2"
            />
          </div>
        </div>
      ) : (
        // Cardio exercise fields
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 flex-wrap">
          {/* Distance/Duration input */}
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">📏</span>
            <Input
              type="text"
              value={localDescription}
              onChange={handleDescriptionChange}
              onBlur={handleDescriptionBlur}
              placeholder="5km / 30min"
              disabled={isSaving || isUpdating}
              className="h-7 w-24 sm:h-8 sm:w-28 text-xs sm:text-sm px-2"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default InlineEditableExercise;
