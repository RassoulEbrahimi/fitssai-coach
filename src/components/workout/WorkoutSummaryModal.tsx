import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, Dumbbell, CheckCircle2, ArrowLeft, Save } from "lucide-react";

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

interface WorkoutSummaryModalProps {
  open: boolean;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;   // Dismiss without saving/finishing (go back)
  onFinish?: () => void; // Actually finish/save the workout
  exercises: Exercise[];
  duration: number;      // Live duration in seconds
  workoutName: string;
  selectedDate: Date;
  getCompletedSetsCount: (exerciseIndex: number) => number;
}

// Parse sets count
const parseSets = (sets: number | string): number => {
  if (typeof sets === 'number') return sets;
  return parseInt(String(sets), 10) || 3;
};

// Format duration in mm:ss or h:mm:ss
const formatDurationLong = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/*
  Completion stats only. There is deliberately no total reps or load: a ticked
  set records that it was done, not how many reps or what weight — multiplying
  the plan's prescription by the ticked sets would present the plan as a
  measured result. Until performance is actually recorded, those figures are
  not shown at all rather than shown as 0 or as the prescription.
*/
const calculateWorkoutStats = (
  exercises: Exercise[],
  getCompletedSetsCount: (exerciseIndex: number) => number
) => {
  let totalSets = 0;
  let completedSets = 0;
  let exercisesCompleted = 0;

  exercises.forEach((exercise, index) => {
    totalSets += parseSets(exercise.sets);
    const completedForExercise = getCompletedSetsCount(index);
    completedSets += completedForExercise;

    // Count exercises with at least one set completed
    if (completedForExercise > 0) {
      exercisesCompleted++;
    }
  });

  return {
    totalSets,
    completedSets,
    exercisesCompleted,
    totalExercises: exercises.length,
  };
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  delay?: number;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.3 }}
    className="bg-muted/30 rounded-xl p-3 flex flex-col items-center justify-center text-center gap-1 border border-border/50"
  >
    <div className="p-1.5 rounded-full bg-primary/10 text-primary mb-1">
      {icon}
    </div>
    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
    <span className="text-lg font-bold text-foreground">
      {value}{unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
    </span>
  </motion.div>
);

const WorkoutSummaryModal: React.FC<WorkoutSummaryModalProps> = ({
  open,
  isSaving = false,
  error,
  onClose,
  onFinish,
  exercises,
  duration,
  workoutName,
  selectedDate,
  getCompletedSetsCount,
}) => {
  const stats = useMemo(() =>
    calculateWorkoutStats(exercises, getCompletedSetsCount),
    [exercises, getCompletedSetsCount]
  );

  const completionPercent = stats.totalSets > 0
    ? Math.round((stats.completedSets / stats.totalSets) * 100)
    : 0;

  // Handle saving
  const handleFinish = () => {
    if (onFinish) {
      onFinish();
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md" />
        <DialogContent className="sm:max-w-md z-[100000] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary/20 via-primary/5 to-transparent px-6 pt-6 pb-6 border-b border-border/40">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />

            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="relative text-center"
            >
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-foreground mx-auto">
                  Training beendet?
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1 max-w-[80%] mx-auto">
                  Du hast {completionPercent}% deines Trainingsplans absolviert.
                </p>
              </DialogHeader>
            </motion.div>

            {/* Completion Ring Wrapper - could be a ring, using badge for now */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.4, type: "spring" }}
              className="flex justify-center mt-4"
            >
              <div className={`px-4 py-1.5 rounded-full text-sm font-bold tracking-tight shadow-sm ${completionPercent === 100
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-amber-500 text-white'
                }`}>
                {workoutName}
              </div>
            </motion.div>
          </div>

          {/* Stats Grid - 2 Columns */}
          <div className="p-5 grid grid-cols-2 gap-3">
            {/* Main Stats */}
            <StatCard
              icon={<Clock className="w-4 h-4" />}
              label="Dauer"
              value={formatDurationLong(duration)}
              delay={0.1}
            />
            <StatCard
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Sätze"
              value={`${stats.completedSets}/${stats.totalSets}`}
              delay={0.15}
            />

            {/* Full width Exercises count */}
            <div className="col-span-2">
              <StatCard
                icon={<Dumbbell className="w-4 h-4" />}
                label="Übungen"
                value={`${stats.exercisesCompleted} von ${stats.totalExercises}`}
                delay={0.2}
              />
            </div>

            <p className="col-span-2 text-xs text-center text-muted-foreground">
              Abgehakte Sätze zählen als erledigt. Wiederholungen und Gewicht werden dabei nicht erfasst.
            </p>
          </div>

          {/* Footer actions */}
          <DialogFooter className="px-6 pb-6 pt-0 flex-col sm:flex-col gap-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="w-full flex flex-col gap-3"
            >
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button
                disabled={isSaving}
                onClick={handleFinish}
                className="w-full h-12 text-base font-bold shadow-md"
                size="lg"
              >
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Training wird gespeichert…' : error ? 'Erneut speichern & beenden' : 'Training speichern & beenden'}
              </Button>

              <Button
                disabled={isSaving}
                onClick={onClose}
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Zurück zum Training
              </Button>
            </motion.div>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export default WorkoutSummaryModal;