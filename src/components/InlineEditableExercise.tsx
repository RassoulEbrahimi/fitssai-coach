import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Info, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';
import { cn } from '@/lib/utils';

// Predefined exercises with field definitions
type ExerciseField = 'sets' | 'reps' | 'weight' | 'rest' | 'distance' | 'duration';

const PREDEFINED_EXERCISES = [
  // Cardio
  { name: 'Laufen', type: 'cardio', icon: '🏃', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Radfahren', type: 'cardio', icon: '🚴', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Schwimmen', type: 'cardio', icon: '🏊', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Rudern', type: 'cardio', icon: '🚣', fields: ['distance', 'duration'] as ExerciseField[] },
  
  // Upper Body - Push
  { name: 'Bankdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Schrägbankdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Schulterdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Liegestütze', type: 'strength', icon: '💪', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Dips', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  
  // Upper Body - Pull
  { name: 'Klimmzüge', type: 'strength', icon: '💪', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Latziehen', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Rudern', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Bizepscurls', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  
  // Lower Body
  { name: 'Kniebeugen', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Kreuzheben', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Beinpresse', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Ausfallschritte', type: 'strength', icon: '🦵', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Beinbeuger', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Beinstrecker', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Wadenheben', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  
  // Core
  { name: 'Planks', type: 'strength', icon: '🧘', fields: ['duration', 'sets'] as ExerciseField[] },
  { name: 'Crunches', type: 'strength', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Russian Twists', type: 'strength', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
] as const;

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
  const [openNamePopover, setOpenNamePopover] = useState(false);
  
  // Parse distance/duration from description for cardio exercises
  const parseDescription = (desc: string) => {
    const distanceMatch = desc.match(/(\d+(?:\.\d+)?)\s*km/i);
    const durationMatch = desc.match(/(\d+)\s*min/i);
    return {
      distance: distanceMatch ? distanceMatch[1] : '',
      duration: durationMatch ? durationMatch[1] : '',
    };
  };

  const formatDescription = (distance: string, duration: string) => {
    const parts = [];
    if (distance) parts.push(`${distance}km`);
    if (duration) parts.push(`${duration}min`);
    return parts.join(' / ');
  };

  // Local state for inputs (for immediate UI updates)
  const [localWeight, setLocalWeight] = useState(exercise.weight || '');
  const [localRest, setLocalRest] = useState(exercise.rest || '');
  const [localDistance, setLocalDistance] = useState('');
  const [localDuration, setLocalDuration] = useState('');

  // Sync local state when exercise prop changes
  React.useEffect(() => {
    setLocalWeight(exercise.weight || '');
    setLocalRest(exercise.rest || '');
    
    // Parse distance/duration from description
    const parsed = parseDescription(exercise.description || '');
    setLocalDistance(parsed.distance);
    setLocalDuration(parsed.duration);
  }, [exercise.weight, exercise.rest, exercise.description]);

  // Get current exercise definition to know which fields to show
  const currentExerciseDetails = PREDEFINED_EXERCISES.find(ex => ex.name === exercise.name);
  const requiredFields = currentExerciseDetails?.fields || [];

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

  const handleDistanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalDistance(e.target.value);
  };

  const handleDistanceBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const newDescription = formatDescription(e.target.value, localDuration);
    if (newDescription !== exercise.description) {
      handleFieldUpdate('description', newDescription);
    }
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalDuration(e.target.value);
  };

  const handleDurationBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const newDescription = formatDescription(localDistance, e.target.value);
    if (newDescription !== exercise.description) {
      handleFieldUpdate('description', newDescription);
    }
  };

  const handleNameChange = async (selectedExerciseName: string) => {
    const selectedExercise = PREDEFINED_EXERCISES.find(ex => ex.name === selectedExerciseName);
    if (!selectedExercise) return;

    setIsSaving(true);
    setOpenNamePopover(false);
    
    try {
      // Build updated exercise with defaults based on required fields
      const updatedExercise: Exercise = {
        ...exercise,
        name: selectedExercise.name,
      };

      // Set defaults based on required fields
      const fields = selectedExercise.fields;
      
      if (fields.includes('sets')) {
        updatedExercise.sets = exercise.sets || 3;
      } else {
        updatedExercise.sets = 1;
      }

      if (fields.includes('reps')) {
        updatedExercise.reps = exercise.reps || '10';
      } else {
        updatedExercise.reps = '1';
      }

      if (fields.includes('weight')) {
        updatedExercise.weight = exercise.weight;
      } else {
        updatedExercise.weight = undefined;
      }

      if (fields.includes('rest')) {
        updatedExercise.rest = exercise.rest;
      } else {
        updatedExercise.rest = undefined;
      }

      if (fields.includes('distance') || fields.includes('duration')) {
        updatedExercise.description = exercise.description || '';
      } else {
        updatedExercise.description = undefined;
      }
      
      await onUpdate(updatedExercise);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn(
      "flex flex-col gap-2 p-1.5 sm:p-2 md:p-3 bg-background/50 rounded-lg border border-border/50",
      "hover:border-primary/30 transition-colors",
      (isSaving || isUpdating) && "opacity-60 pointer-events-none"
    )}>
      {/* Header: Editable exercise name + info button + loading indicator */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Popover open={openNamePopover} onOpenChange={setOpenNamePopover}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={openNamePopover}
              className="flex-1 justify-start h-auto p-1 font-medium text-foreground text-sm sm:text-sm md:text-base min-w-0 hover:bg-accent/50"
              disabled={isSaving || isUpdating}
            >
              <span className="mr-1.5 text-base sm:text-lg flex-shrink-0">
                {currentExerciseDetails?.icon || '💪'}
              </span>
              <span className="truncate">{exercise.name}</span>
              <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Übung suchen..." />
              <CommandList>
                <CommandEmpty>Keine Übung gefunden.</CommandEmpty>
                <CommandGroup heading="Cardio">
                  {PREDEFINED_EXERCISES
                    .filter(ex => ex.type === 'cardio')
                    .map((predefinedExercise) => (
                      <CommandItem
                        key={predefinedExercise.name}
                        value={predefinedExercise.name}
                        onSelect={handleNameChange}
                        className="cursor-pointer"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            exercise.name === predefinedExercise.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="mr-2 text-lg">{predefinedExercise.icon}</span>
                        <span>{predefinedExercise.name}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandGroup heading="Krafttraining">
                  {PREDEFINED_EXERCISES
                    .filter(ex => ex.type === 'strength')
                    .map((predefinedExercise) => (
                      <CommandItem
                        key={predefinedExercise.name}
                        value={predefinedExercise.name}
                        onSelect={handleNameChange}
                        className="cursor-pointer"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            exercise.name === predefinedExercise.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="mr-2 text-lg">{predefinedExercise.icon}</span>
                        <span>{predefinedExercise.name}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        
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

      {/* Dynamic fields based on exercise requirements */}
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 flex-wrap">
        {requiredFields.includes('sets') && (
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
        )}

        {requiredFields.includes('reps') && (
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
        )}

        {requiredFields.includes('weight') && (
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
        )}

        {requiredFields.includes('rest') && (
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
        )}

        {requiredFields.includes('distance') && (
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">📏</span>
            <Input
              type="text"
              value={localDistance}
              onChange={handleDistanceChange}
              onBlur={handleDistanceBlur}
              placeholder="5km"
              disabled={isSaving || isUpdating}
              className="h-7 w-16 sm:h-8 sm:w-20 text-xs sm:text-sm px-2"
            />
          </div>
        )}

        {requiredFields.includes('duration') && (
          <div className="flex items-center gap-1">
            <span className="text-sm md:text-base" aria-hidden="true">⏱️</span>
            <Input
              type="text"
              value={localDuration}
              onChange={handleDurationChange}
              onBlur={handleDurationBlur}
              placeholder="30min"
              disabled={isSaving || isUpdating}
              className="h-7 w-16 sm:h-8 sm:w-20 text-xs sm:text-sm px-2"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default InlineEditableExercise;
