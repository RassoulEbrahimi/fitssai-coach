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

// Helper function to highlight matching text
const highlightMatch = (text: string, search: string) => {
  if (!search.trim()) return <span>{text}</span>;
  
  const regex = new RegExp(`(${search})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, index) => 
        regex.test(part) ? (
          <mark key={index} className="bg-primary/20 text-primary font-semibold px-0.5 rounded">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

// Predefined exercises with field definitions
type ExerciseField = 'sets' | 'reps' | 'weight' | 'rest' | 'distance' | 'duration';

const PREDEFINED_EXERCISES = [
  // Cardio
  { name: 'Laufen', type: 'cardio', icon: '🏃', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Radfahren', type: 'cardio', icon: '🚴', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Schwimmen', type: 'cardio', icon: '🏊', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Rudern (Cardio)', type: 'cardio', icon: '🚣', fields: ['distance', 'duration'] as ExerciseField[] },
  
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
  { name: 'Planks', type: 'core', icon: '🧘', fields: ['duration', 'sets'] as ExerciseField[] },
  { name: 'Crunches', type: 'core', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Russian Twists', type: 'core', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Mountain Climbers', type: 'core', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Beinheben', type: 'core', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
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
  const [searchTerm, setSearchTerm] = useState('');
  
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
      "flex flex-wrap items-center gap-2 p-1 sm:p-1.5",
      (isSaving || isUpdating) && "opacity-60 pointer-events-none"
    )}>
      {/* Exercise name container - shrink-wrapped with rounded background */}
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-accent/30 rounded-md border border-border/30">
        <Popover open={openNamePopover} onOpenChange={setOpenNamePopover}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={openNamePopover}
              className="h-auto p-0 font-medium text-foreground text-sm hover:bg-transparent"
              disabled={isSaving || isUpdating}
            >
              <span className="mr-1 text-base flex-shrink-0">
                {currentExerciseDetails?.icon || '💪'}
              </span>
              <span className="whitespace-nowrap">{exercise.name}</span>
              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[90vw] sm:w-[420px] p-0 z-[100] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-200" align="start">
            <Command className="rounded-lg border-border shadow-xl bg-popover">
              <CommandInput 
                placeholder="Übung suchen..." 
                className="h-11 border-b border-border/50 text-sm focus:ring-0"
                onValueChange={setSearchTerm}
              />
              <CommandList className="max-h-[320px] overflow-y-auto scroll-smooth">
                <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                  Keine Übung gefunden.
                </CommandEmpty>
                
                <CommandGroup 
                  heading="🏃 CARDIO" 
                  className="px-2 py-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:border-b [&_[cmdk-group-heading]]:border-border/40 [&_[cmdk-group-heading]]:mb-2"
                >
                  {PREDEFINED_EXERCISES
                    .filter(ex => ex.type === 'cardio')
                    .map((predefinedExercise) => (
                      <CommandItem
                        key={predefinedExercise.name}
                        value={predefinedExercise.name}
                        onSelect={handleNameChange}
                        className={cn(
                          "cursor-pointer px-3 py-2.5 my-0.5 rounded-md",
                          "transition-all duration-150 ease-in-out",
                          "hover:bg-accent/80 hover:text-accent-foreground",
                          "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                          "active:scale-[0.98]",
                          exercise.name === predefinedExercise.name && "bg-primary/10 hover:bg-primary/15"
                        )}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0 text-primary transition-opacity duration-150",
                            exercise.name === predefinedExercise.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="mr-2 text-lg shrink-0">{predefinedExercise.icon || '💪'}</span>
                        <span className="truncate text-sm font-medium">
                          {highlightMatch(predefinedExercise.name, searchTerm)}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>

                <CommandGroup 
                  heading="💪 KRAFTTRAINING" 
                  className="px-2 py-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:border-b [&_[cmdk-group-heading]]:border-border/40 [&_[cmdk-group-heading]]:mb-2"
                >
                  {PREDEFINED_EXERCISES
                    .filter(ex => ex.type === 'strength')
                    .map((predefinedExercise) => (
                      <CommandItem
                        key={predefinedExercise.name}
                        value={predefinedExercise.name}
                        onSelect={handleNameChange}
                        className={cn(
                          "cursor-pointer px-3 py-2.5 my-0.5 rounded-md",
                          "transition-all duration-150 ease-in-out",
                          "hover:bg-accent/80 hover:text-accent-foreground",
                          "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                          "active:scale-[0.98]",
                          exercise.name === predefinedExercise.name && "bg-primary/10 hover:bg-primary/15"
                        )}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0 text-primary transition-opacity duration-150",
                            exercise.name === predefinedExercise.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="mr-2 text-lg shrink-0">{predefinedExercise.icon || '💪'}</span>
                        <span className="truncate text-sm font-medium">
                          {highlightMatch(predefinedExercise.name, searchTerm)}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>

                <CommandGroup 
                  heading="🧘 CORE" 
                  className="px-2 py-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:border-b [&_[cmdk-group-heading]]:border-border/40 [&_[cmdk-group-heading]]:mb-2"
                >
                  {PREDEFINED_EXERCISES
                    .filter(ex => ex.type === 'core')
                    .map((predefinedExercise) => (
                      <CommandItem
                        key={predefinedExercise.name}
                        value={predefinedExercise.name}
                        onSelect={handleNameChange}
                        className={cn(
                          "cursor-pointer px-3 py-2.5 my-0.5 rounded-md",
                          "transition-all duration-150 ease-in-out",
                          "hover:bg-accent/80 hover:text-accent-foreground",
                          "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                          "active:scale-[0.98]",
                          exercise.name === predefinedExercise.name && "bg-primary/10 hover:bg-primary/15"
                        )}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0 text-primary transition-opacity duration-150",
                            exercise.name === predefinedExercise.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="mr-2 text-lg shrink-0">{predefinedExercise.icon || '💪'}</span>
                        <span className="truncate text-sm font-medium">
                          {highlightMatch(predefinedExercise.name, searchTerm)}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Action icons immediately to the right */}
        {(isSaving || isUpdating) && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onInfo}
          className="h-auto w-auto p-0 text-muted-foreground hover:text-foreground hover:bg-transparent flex-shrink-0"
          aria-label={`Info für ${exercise.name}`}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Parameter fields - inline with auto width */}
      {requiredFields.includes('sets') && (
        <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
          <span className="text-sm leading-none" aria-hidden="true">🏋️</span>
          <Select
            value={String(exercise.sets)}
            onValueChange={handleSetsChange}
            disabled={isSaving || isUpdating}
          >
            <SelectTrigger className="h-auto w-auto border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus:ring-0 [&>svg]:hidden">
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
          <span className="text-xs sm:text-sm text-muted-foreground leading-none">×</span>
          <Select
            value={String(exercise.reps)}
            onValueChange={handleRepsChange}
            disabled={isSaving || isUpdating}
          >
            <SelectTrigger className="h-auto w-auto border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus:ring-0 [&>svg]:hidden">
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
        <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
          <span className="text-sm leading-none" aria-hidden="true">⚖️</span>
          <Input
            type="text"
            value={localWeight}
            onChange={handleWeightChange}
            onBlur={handleWeightBlur}
            placeholder="kg"
            disabled={isSaving || isUpdating}
            className="h-auto w-auto min-w-[2rem] max-w-[3rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}

      {requiredFields.includes('rest') && (
        <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
          <span className="text-sm leading-none" aria-hidden="true">⏱</span>
          <Input
            type="text"
            value={localRest}
            onChange={handleRestChange}
            onBlur={handleRestBlur}
            placeholder="90s"
            disabled={isSaving || isUpdating}
            className="h-auto w-auto min-w-[2rem] max-w-[3rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}

      {requiredFields.includes('distance') && (
        <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
          <span className="text-sm leading-none" aria-hidden="true">📏</span>
          <Input
            type="text"
            value={localDistance}
            onChange={handleDistanceChange}
            onBlur={handleDistanceBlur}
            placeholder="5km"
            disabled={isSaving || isUpdating}
            className="h-auto w-auto min-w-[2rem] max-w-[3rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}

      {requiredFields.includes('duration') && (
        <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
          <span className="text-sm leading-none" aria-hidden="true">⏱️</span>
          <Input
            type="text"
            value={localDuration}
            onChange={handleDurationChange}
            onBlur={handleDurationBlur}
            placeholder="30min"
            disabled={isSaving || isUpdating}
            className="h-auto w-auto min-w-[2.5rem] max-w-[4rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}
    </div>
  );
};

export default InlineEditableExercise;
