import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExerciseSelector, PREDEFINED_EXERCISES } from '@/components/ExerciseSelector';
import type { Exercise } from '@/hooks/useExerciseEditor';

interface ManualWorkoutFormProps {
  onSave: (exercise: Exercise) => void;
  isLoading?: boolean;
  onCancel?: () => void;
}

export const ManualWorkoutForm: React.FC<ManualWorkoutFormProps> = ({
  onSave,
  isLoading = false,
  onCancel,
}) => {
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

  const handleSelectExercise = (exercise: typeof PREDEFINED_EXERCISES[number]) => {
    setSelectedExercise(exercise);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
    <form onSubmit={handleSubmit} className="space-y-4 max-w-full overflow-hidden px-3">
      {/* Exercise Selection */}
      <div className="space-y-2">
        <Label className="text-emerald-200">Übung auswählen</Label>
        <AnimatePresence mode="wait">
          {selectedExercise ? (
            <motion.div
              key="selected-exercise"
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 bg-emerald-500/10 rounded-lg border border-emerald-400/30 backdrop-blur-xl min-w-0 w-full"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-2xl flex-shrink-0">{selectedExercise.icon}</span>
                <span 
                  className="font-medium text-emerald-100 truncate" 
                  title={selectedExercise.name}
                >
                  {selectedExercise.name}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedExercise(null)}
                className="h-8 w-8 p-0 text-emerald-300 hover:text-emerald-100 flex-shrink-0 ml-2 transition-colors duration-200"
                title="Ändern"
              >
                <Edit3 className="w-5 h-5" />
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="exercise-selector"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <ExerciseSelector 
                onSelect={handleSelectExercise} 
                currentExercise={selectedExercise}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Dynamic Fields Based on Exercise Type */}
      {selectedExercise && (
        <div className="space-y-4 pt-4 border-t border-emerald-400/20">
          <AnimatePresence mode="wait">
            {selectedExercise.type === 'cardio' ? (
              <motion.div
                key="cardio"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {/* Cardio fields - Compact 2-column grid */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="distance" className="text-xs font-medium text-emerald-200">Distanz</Label>
                    <Input
                      id="distance"
                      type="text"
                      placeholder="z.B. 5 km"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="duration" className="text-xs font-medium text-emerald-200">Zeit</Label>
                    <Input
                      id="duration"
                      type="text"
                      placeholder="z.B. 30 min"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="strength"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {/* Strength training fields - Compact 2×2 grid */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="sets" className="text-xs font-medium text-emerald-200">Sätze *</Label>
                    <Input
                      id="sets"
                      type="number"
                      min="1"
                      max="20"
                      value={sets}
                      onChange={(e) => setSets(e.target.value)}
                      required
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="reps" className="text-xs font-medium text-emerald-200">Reps *</Label>
                    <Input
                      id="reps"
                      type="text"
                      placeholder="z.B. 8-12"
                      value={reps}
                      onChange={(e) => setReps(e.target.value)}
                      required
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="weight" className="text-xs font-medium text-emerald-200">Gewicht</Label>
                    <Input
                      id="weight"
                      type="text"
                      placeholder="z.B. 60kg"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <Label htmlFor="rest" className="text-xs font-medium text-emerald-200">Pause</Label>
                    <Input
                      id="rest"
                      type="text"
                      placeholder="z.B. 90s"
                      value={rest}
                      onChange={(e) => setRest(e.target.value)}
                      className="bg-emerald-500/5 border-emerald-400/30 text-emerald-100 py-2.5 px-3 sm:py-3"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Form Actions */}
      <div className="flex flex-wrap justify-between gap-2 pt-4 w-full max-w-full">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/10"
          >
            Abbrechen
          </Button>
        )}
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
            type="submit"
            disabled={!isFormValid() || isLoading}
            className="flex-1 sm:flex-none bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium shadow-lg"
          >
            {isLoading ? 'Wird hinzugefügt...' : 'Hinzufügen'}
          </Button>
        </motion.div>
      </div>
    </form>
  );
};
