import React, { useState, useRef } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info, Loader2, ChevronsUpDown, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';
import { cn } from '@/lib/utils';
import { ExerciseSelector, PREDEFINED_EXERCISES } from '@/components/ExerciseSelector';

// Predefined exercises with field definitions
type ExerciseField = 'sets' | 'reps' | 'weight' | 'rest' | 'distance' | 'duration';
const PREDEFINED_EXERCISES_WITH_FIELDS = [
// Cardio
{
  name: 'Laufen',
  type: 'cardio',
  icon: '🏃',
  fields: ['distance', 'duration'] as ExerciseField[]
}, {
  name: 'Radfahren',
  type: 'cardio',
  icon: '🚴',
  fields: ['distance', 'duration'] as ExerciseField[]
}, {
  name: 'Schwimmen',
  type: 'cardio',
  icon: '🏊',
  fields: ['distance', 'duration'] as ExerciseField[]
}, {
  name: 'Rudern',
  type: 'cardio',
  icon: '🚣',
  fields: ['distance', 'duration'] as ExerciseField[]
},
// Upper Body - Push
{
  name: 'Bankdrücken',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[]
}, {
  name: 'Schrägbankdrücken',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[]
}, {
  name: 'Schulterdrücken',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[]
}, {
  name: 'Liegestütze',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps'] as ExerciseField[]
}, {
  name: 'Dips',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
},
// Upper Body - Pull
{
  name: 'Klimmzüge',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps'] as ExerciseField[]
}, {
  name: 'Latziehen',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
}, {
  name: 'Rudern',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
}, {
  name: 'Bizepscurls',
  type: 'strength',
  icon: '💪',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
},
// Lower Body
{
  name: 'Kniebeugen',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[]
}, {
  name: 'Kreuzheben',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[]
}, {
  name: 'Beinpresse',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
}, {
  name: 'Ausfallschritte',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps'] as ExerciseField[]
}, {
  name: 'Beinbeuger',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
}, {
  name: 'Beinstrecker',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
}, {
  name: 'Wadenheben',
  type: 'strength',
  icon: '🦵',
  fields: ['sets', 'reps', 'weight'] as ExerciseField[]
},
// Core
{
  name: 'Planks',
  type: 'strength',
  icon: '🧘',
  fields: ['duration', 'sets'] as ExerciseField[]
}, {
  name: 'Crunches',
  type: 'strength',
  icon: '🧘',
  fields: ['sets', 'reps'] as ExerciseField[]
}, {
  name: 'Russian Twists',
  type: 'strength',
  icon: '🧘',
  fields: ['sets', 'reps'] as ExerciseField[]
}] as const;
interface InlineEditableExerciseProps {
  exercise: Exercise;
  exerciseIndex: number;
  onUpdate: (updatedExercise: Exercise) => Promise<void>;
  onInfo: () => void;
  onDelete?: (exerciseIndex: number) => void;
  isUpdating?: boolean;
}
const InlineEditableExercise: React.FC<InlineEditableExerciseProps> = ({
  exercise,
  exerciseIndex,
  onUpdate,
  onInfo,
  onDelete,
  isUpdating = false
}) => {
  const {
    t
  } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [openNamePopover, setOpenNamePopover] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const controls = useAnimation();
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Parse distance/duration from description for cardio exercises
  const parseDescription = (desc: string) => {
    const distanceMatch = desc.match(/(\d+(?:\.\d+)?)\s*km/i);
    const durationMatch = desc.match(/(\d+)\s*min/i);
    return {
      distance: distanceMatch ? distanceMatch[1] : '',
      duration: durationMatch ? durationMatch[1] : ''
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

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  const clearAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  const closeDeletePanel = () => {
    clearAutoCloseTimer();
    setIsDeleteOpen(false);
    controls.start({ 
      x: 0, 
      transition: { type: 'spring', stiffness: 300, damping: 30 } 
    });
  };

  // Get current exercise definition to know which fields to show
  const currentExerciseDetails = PREDEFINED_EXERCISES_WITH_FIELDS.find(ex => ex.name === exercise.name);
  const requiredFields = currentExerciseDetails?.fields || [];
  const handleFieldUpdate = async (field: keyof Exercise, value: any) => {
    setIsSaving(true);
    try {
      await onUpdate({
        ...exercise,
        [field]: value
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
  const handleDeleteClick = async () => {
    clearAutoCloseTimer();
    await controls.start({ 
      x: -500, 
      opacity: 0, 
      transition: { type: 'spring', stiffness: 300, damping: 30 } 
    });
    if (onDelete) {
      onDelete(exerciseIndex);
    }
  };

  const handleNameChange = async (selectedExercise: typeof PREDEFINED_EXERCISES[number]) => {
    const selectedExerciseWithFields = PREDEFINED_EXERCISES_WITH_FIELDS.find(ex => ex.name === selectedExercise.name);
    if (!selectedExerciseWithFields) return;
    setIsSaving(true);
    setOpenNamePopover(false);
    try {
      // Build updated exercise with defaults based on required fields
      const updatedExercise: Exercise = {
        ...exercise,
        name: selectedExercise.name
      };

      // Set defaults based on required fields
      const fields = selectedExerciseWithFields.fields;
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
    <div className="relative overflow-hidden">
      {/* Background delete panel - revealed on swipe */}
      <div className="absolute inset-0 bg-destructive/20 flex items-center justify-end pr-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDeleteClick}
          className="flex items-center gap-2 text-destructive hover:text-destructive hover:bg-transparent"
        >
          <Trash2 className="h-5 w-5" />
          <span className="text-sm font-medium">Löschen</span>
        </Button>
      </div>

      {/* Draggable content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -80, right: 0 }}
        dragElastic={0.2}
        dragTransition={{ bounceStiffness: 300, bounceDamping: 20 }}
        animate={controls}
        onDragStart={() => {
          clearAutoCloseTimer();
        }}
        onDragEnd={(event, info) => {
          const dragDistance = info.offset.x;
          
          if (dragDistance <= -150) {
            // Deep swipe - auto delete with slide-out animation
            clearAutoCloseTimer();
            setIsDeleteOpen(false);
            controls.start({ 
              x: -500, 
              opacity: 0, 
              transition: { type: 'spring', stiffness: 300, damping: 30 } 
            }).then(() => {
              if (onDelete) {
                onDelete(exerciseIndex);
              }
            });
          } else if (dragDistance <= -60) {
            // Short swipe - reveal delete button
            setIsDeleteOpen(true);
            controls.start({ 
              x: -80, 
              transition: { type: 'spring', stiffness: 300, damping: 30 } 
            });
            // Start auto-close timer
            clearAutoCloseTimer();
            autoCloseTimerRef.current = setTimeout(() => {
              closeDeletePanel();
            }, 3000);
          } else {
            // Cancel - snap back to closed
            closeDeletePanel();
          }
        }}
        onClick={(e) => {
          if (isDeleteOpen) {
            e.preventDefault();
            e.stopPropagation();
            closeDeletePanel();
          }
        }}
        className={cn(
          "flex flex-wrap items-center gap-2 p-1 sm:p-1.5 bg-background relative",
          (isSaving || isUpdating) && "opacity-60 pointer-events-none"
        )}
      >
        {/* Exercise name container - shrink-wrapped with rounded background */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-accent/30 rounded-md border border-border/30">
          <Popover open={openNamePopover} onOpenChange={setOpenNamePopover}>
            <PopoverTrigger asChild>
              <Button variant="ghost" role="combobox" aria-expanded={openNamePopover} className="h-auto p-0 font-medium text-foreground text-sm hover:bg-transparent" disabled={isSaving || isUpdating}>
                <span className="mr-1 text-base flex-shrink-0">
                  {currentExerciseDetails?.icon || '💪'}
                </span>
                <span className="whitespace-nowrap">{exercise.name}</span>
                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              className="w-[90vw] sm:w-[420px] p-3 z-[100] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-200" 
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <ExerciseSelector 
                onSelect={handleNameChange} 
                currentExercise={PREDEFINED_EXERCISES.find(ex => ex.name === exercise.name) || null} 
              />
            </PopoverContent>
          </Popover>

          {/* Action icons immediately to the right */}
          {(isSaving || isUpdating) && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />}
          <Button variant="ghost" size="sm" onClick={onInfo} className="h-auto w-auto p-0 text-muted-foreground hover:text-foreground hover:bg-transparent flex-shrink-0" aria-label={`Info für ${exercise.name}`}>
            <Info className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Parameter fields - inline with auto width */}
        {requiredFields.includes('sets') && <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
            <span className="text-sm leading-none" aria-hidden="true">🏋️</span>
            <Select value={String(exercise.sets)} onValueChange={handleSetsChange} disabled={isSaving || isUpdating}>
              <SelectTrigger className="h-auto w-auto border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus:ring-0 [&>svg]:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border z-50 shadow-lg">
                {Array.from({
              length: 10
            }, (_, i) => i + 1).map(num => <SelectItem key={num} value={String(num)} className="hover:bg-accent focus:bg-accent">
                    {num}
                  </SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs sm:text-sm text-muted-foreground leading-none">×</span>
            <Select value={String(exercise.reps)} onValueChange={handleRepsChange} disabled={isSaving || isUpdating}>
              <SelectTrigger className="h-auto w-auto border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus:ring-0 [&>svg]:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border z-50 shadow-lg">
                {Array.from({
              length: 20
            }, (_, i) => i + 1).map(num => <SelectItem key={num} value={String(num)} className="hover:bg-accent focus:bg-accent">
                    {num}
                  </SelectItem>)}
              </SelectContent>
            </Select>
          </div>}

        {requiredFields.includes('weight') && <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
            <span className="text-sm leading-none" aria-hidden="true">⚖️</span>
            <Input type="text" value={localWeight} onChange={handleWeightChange} onBlur={handleWeightBlur} placeholder="kg" disabled={isSaving || isUpdating} className="h-auto w-auto min-w-[1.4rem] max-w-[1.6rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0" />
          </div>}

        {requiredFields.includes('rest') && <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
            <span className="text-sm leading-none" aria-hidden="true">⏱</span>
            <Input type="text" value={localRest} onChange={handleRestChange} onBlur={handleRestBlur} placeholder="90s" disabled={isSaving || isUpdating} className="h-auto w-auto min-w-[1.6rem] max-w-[1.7rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0" />
          </div>}

        {requiredFields.includes('distance') && <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
            <span className="text-sm leading-none" aria-hidden="true">📏</span>
            <Input type="text" value={localDistance} onChange={handleDistanceChange} onBlur={handleDistanceBlur} placeholder="5km" disabled={isSaving || isUpdating} className="h-auto w-auto min-w-[2rem] max-w-[3rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0" />
          </div>}

        {requiredFields.includes('duration') && <div className="inline-flex items-center justify-center shrink gap-0.5 px-1.5 py-1 bg-background/50 rounded-md border border-border/30">
            <span className="text-sm leading-none" aria-hidden="true">⏱️</span>
            <Input type="text" value={localDuration} onChange={handleDurationChange} onBlur={handleDurationBlur} placeholder="30min" disabled={isSaving || isUpdating} className="h-auto w-auto min-w-[2.5rem] max-w-[4rem] border-0 bg-transparent p-0 text-xs sm:text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0" />
          </div>}
      </motion.div>
    </div>
  );
};
export default InlineEditableExercise;