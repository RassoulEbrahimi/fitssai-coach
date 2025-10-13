import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';
import { cn } from '@/lib/utils';

interface AddWorkoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (exercise: Exercise) => void;
  isLoading?: boolean;
}

// Predefined exercises with their types
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

export const AddWorkoutDialog: React.FC<AddWorkoutDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  
  // Exercise selection state
  const [selectedExercise, setSelectedExercise] = useState<typeof PREDEFINED_EXERCISES[number] | null>(null);
  const [searchValue, setSearchValue] = useState('');
  
  // Form state for strength exercises
  const [sets, setSets] = useState('3');
  const [reps, setReps] = useState('10');
  const [weight, setWeight] = useState('');
  const [rest, setRest] = useState('90s');
  
  // Form state for cardio exercises
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  
  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedExercise(null);
      setSearchValue('');
      setSets('3');
      setReps('10');
      setWeight('');
      setRest('90s');
      setDistance('');
      setDuration('');
    }
  }, [open]);

  const handleSelectExercise = (exercise: typeof PREDEFINED_EXERCISES[number]) => {
    setSelectedExercise(exercise);
  };

  const handleSave = () => {
    if (!selectedExercise) return;

    let exercise: Exercise;

    if (selectedExercise.type === 'cardio') {
      // For cardio, use distance/duration in description
      const description = [
        distance && `${distance} km`,
        duration && `${duration} min`,
      ].filter(Boolean).join(', ');

      exercise = {
        name: selectedExercise.name,
        sets: 1,
        reps: '1',
        description: description || undefined,
      };
    } else {
      // For strength exercises
      exercise = {
        name: selectedExercise.name,
        sets: parseInt(sets) || 3,
        reps: reps.trim() || '10',
        weight: weight.trim() || undefined,
        rest: rest.trim() || undefined,
      };
    }

    onSave(exercise);
    onOpenChange(false);
  };

  const isFormValid = () => {
    if (!selectedExercise) return false;

    if (selectedExercise.type === 'cardio') {
      return distance.trim() !== '' || duration.trim() !== '';
    } else {
      return sets !== '' && reps.trim() !== '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Übung hinzufügen</DialogTitle>
          <DialogDescription>
            Wähle eine Übung aus und gib die Details ein
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Exercise Selection */}
          <div className="space-y-2">
            <Label>Übung auswählen</Label>
            {selectedExercise ? (
              <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg border border-primary/20">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{selectedExercise.icon}</span>
                  <span className="font-medium">{selectedExercise.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedExercise(null)}
                  className="h-8"
                >
                  Ändern
                </Button>
              </div>
            ) : (
              <Command className="rounded-lg border">
                <CommandInput 
                  placeholder="Übung suchen..." 
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  <CommandEmpty>Keine Übung gefunden.</CommandEmpty>
                  <CommandGroup heading="Cardio">
                    {PREDEFINED_EXERCISES
                      .filter(ex => ex.type === 'cardio')
                      .map((exercise) => (
                        <CommandItem
                          key={exercise.name}
                          value={exercise.name}
                          onSelect={() => handleSelectExercise(exercise)}
                          className="cursor-pointer"
                        >
                          <span className="mr-2 text-lg">{exercise.icon}</span>
                          <span>{exercise.name}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                  <CommandGroup heading="Krafttraining">
                    {PREDEFINED_EXERCISES
                      .filter(ex => ex.type === 'strength')
                      .map((exercise) => (
                        <CommandItem
                          key={exercise.name}
                          value={exercise.name}
                          onSelect={() => handleSelectExercise(exercise)}
                          className="cursor-pointer"
                        >
                          <span className="mr-2 text-lg">{exercise.icon}</span>
                          <span>{exercise.name}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </div>

          {/* Dynamic Fields Based on Exercise Type */}
          {selectedExercise && (
            <div className="space-y-4 pt-4 border-t">
              {selectedExercise.type === 'cardio' ? (
                // Cardio fields
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="distance">Distanz (km)</Label>
                    <Input
                      id="distance"
                      type="text"
                      placeholder="z.B. 5"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="duration">Zeit (min)</Label>
                    <Input
                      id="duration"
                      type="text"
                      placeholder="z.B. 30"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                // Strength training fields
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sets">Sätze *</Label>
                      <Input
                        id="sets"
                        type="number"
                        min="1"
                        max="20"
                        value={sets}
                        onChange={(e) => setSets(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reps">Wiederholungen *</Label>
                      <Input
                        id="reps"
                        type="text"
                        placeholder="z.B. 8-12"
                        value={reps}
                        onChange={(e) => setReps(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="weight">Gewicht (optional)</Label>
                      <Input
                        id="weight"
                        type="text"
                        placeholder="z.B. 60kg"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rest">Pause (optional)</Label>
                      <Input
                        id="rest"
                        type="text"
                        placeholder="z.B. 90s"
                        value={rest}
                        onChange={(e) => setRest(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isFormValid() || isLoading}
          >
            <Plus className="h-4 w-4 mr-2" />
            Hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
