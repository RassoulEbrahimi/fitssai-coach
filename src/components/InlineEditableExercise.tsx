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

// Predefined exercises (same as AddWorkoutDialog)
const PREDEFINED_EXERCISES = [
  // Cardio
  { name: 'Laufen', type: 'cardio', icon: '🏃' },
  { name: 'Radfahren', type: 'cardio', icon: '🚴' },
  { name: 'Schwimmen', type: 'cardio', icon: '🏊' },
  { name: 'Rudern', type: 'cardio', icon: '🚣' },
  
  // Upper Body - Push
  { name: 'Bankdrücken', type: 'strength', icon: '💪' },
  { name: 'Schrägbankdrücken', type: 'strength', icon: '💪' },
  { name: 'Schulterdrücken', type: 'strength', icon: '💪' },
  { name: 'Liegestütze', type: 'strength', icon: '💪' },
  { name: 'Dips', type: 'strength', icon: '💪' },
  
  // Upper Body - Pull
  { name: 'Klimmzüge', type: 'strength', icon: '💪' },
  { name: 'Latziehen', type: 'strength', icon: '💪' },
  { name: 'Rudern', type: 'strength', icon: '💪' },
  { name: 'Bizepscurls', type: 'strength', icon: '💪' },
  
  // Lower Body
  { name: 'Kniebeugen', type: 'strength', icon: '🦵' },
  { name: 'Kreuzheben', type: 'strength', icon: '🦵' },
  { name: 'Beinpresse', type: 'strength', icon: '🦵' },
  { name: 'Ausfallschritte', type: 'strength', icon: '🦵' },
  { name: 'Beinbeuger', type: 'strength', icon: '🦵' },
  { name: 'Beinstrecker', type: 'strength', icon: '🦵' },
  { name: 'Wadenheben', type: 'strength', icon: '🦵' },
  
  // Core
  { name: 'Planks', type: 'strength', icon: '🧘' },
  { name: 'Crunches', type: 'strength', icon: '🧘' },
  { name: 'Russian Twists', type: 'strength', icon: '🧘' },
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

  const handleNameChange = async (selectedExerciseName: string) => {
    const selectedExercise = PREDEFINED_EXERCISES.find(ex => ex.name === selectedExerciseName);
    if (!selectedExercise) return;

    setIsSaving(true);
    setOpenNamePopover(false);
    
    try {
      // Build updated exercise based on type
      let updatedExercise: Exercise;
      
      if (selectedExercise.type === 'cardio') {
        // Reset to cardio defaults
        updatedExercise = {
          ...exercise,
          name: selectedExercise.name,
          sets: 1,
          reps: '1',
          description: exercise.description || '',
          weight: undefined,
          rest: undefined,
        };
      } else {
        // Reset to strength defaults
        updatedExercise = {
          ...exercise,
          name: selectedExercise.name,
          sets: exercise.sets || 3,
          reps: exercise.reps || '10',
          description: undefined,
        };
      }
      
      await onUpdate(updatedExercise);
    } finally {
      setIsSaving(false);
    }
  };

  // Find current exercise details for icon display
  const currentExerciseDetails = PREDEFINED_EXERCISES.find(ex => ex.name === exercise.name);

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
