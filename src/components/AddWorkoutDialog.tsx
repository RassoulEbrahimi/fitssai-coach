import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Exercise } from '@/hooks/useExerciseEditor';
import { ExerciseSelector, PREDEFINED_EXERCISES } from '@/components/ExerciseSelector';

interface AddWorkoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (exercise: Exercise) => void;
  isLoading?: boolean;
}

export const AddWorkoutDialog: React.FC<AddWorkoutDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  
  // Exercise selection state
  const [selectedExercise, setSelectedExercise] = useState<typeof PREDEFINED_EXERCISES[number] | null>(null);
  
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
              <ExerciseSelector onSelect={handleSelectExercise} />
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
          <motion.div
            whileTap={
              window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? {}
                : {
                    scale: [1, 1.05, 1],
                    filter: [
                      "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                      "drop-shadow(0 0 14px rgba(0, 255, 156, 0.4))",
                      "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                    ]
                  }
            }
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <Button
              onClick={handleSave}
              disabled={!isFormValid() || isLoading}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Hinzufügen
            </Button>
          </motion.div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
