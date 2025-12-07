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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, Dumbbell, CheckCircle2, Repeat, Weight, ChevronRight } from "lucide-react";

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

interface WorkoutSummaryModalProps {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  duration: number; // in seconds
  workoutName: string;
  selectedDate: Date;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean;
}

// Parse weight string like "10 kg" or "12.5kg" to number
const parseWeight = (weight?: string): number => {
  if (!weight) return 0;
  const match = weight.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
};

// Parse reps string or number
const parseReps = (reps: number | string): number => {
  if (typeof reps === 'number') return reps;
  const match = String(reps).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

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

// Calculate comprehensive workout stats
const calculateWorkoutStats = (
  exercises: Exercise[],
  getCompletedSetsCount: (exerciseIndex: number) => number,
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean
) => {
  let totalVolume = 0;
  let totalSets = 0;
  let completedSets = 0;
  let totalReps = 0;
  let exercisesCompleted = 0;

  exercises.forEach((exercise, index) => {
    const numSets = parseSets(exercise.sets);
    const repsPerSet = parseReps(exercise.reps);
    const weight = parseWeight(exercise.weight);
    
    totalSets += numSets;
    const completedForExercise = getCompletedSetsCount(index);
    completedSets += completedForExercise;
    
    // Count exercises with at least one set completed
    if (completedForExercise > 0) {
      exercisesCompleted++;
    }
    
    // Calculate volume and reps for completed sets
    for (let setNum = 1; setNum <= numSets; setNum++) {
      if (isSetCompleted(index, setNum)) {
        totalVolume += weight * repsPerSet;
        totalReps += repsPerSet;
      }
    }
  });

  return {
    totalVolume: Math.round(totalVolume),
    totalSets,
    completedSets,
    totalReps,
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
    initial={{ opacity: 0, y: 20, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ delay, duration: 0.4, type: "spring", stiffness: 150 }}
    className="relative overflow-hidden rounded-xl bg-muted/40 border border-border/50 p-4 backdrop-blur-sm"
  >
    {/* Subtle glow effect */}
    <div className="absolute -top-8 -right-8 w-16 h-16 bg-primary/10 rounded-full blur-2xl" />
    
    <div className="relative flex flex-col gap-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-foreground">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  </motion.div>
);

const WorkoutSummaryModal: React.FC<WorkoutSummaryModalProps> = ({
  open,
  onClose,
  exercises,
  duration,
  workoutName,
  selectedDate,
  getCompletedSetsCount,
  isSetCompleted,
}) => {
  const stats = useMemo(() => 
    calculateWorkoutStats(exercises, getCompletedSetsCount, isSetCompleted),
    [exercises, getCompletedSetsCount, isSetCompleted]
  );

  const completionPercent = stats.totalSets > 0 
    ? Math.round((stats.completedSets / stats.totalSets) * 100) 
    : 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md z-[100000] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        {/* Header with gradient */}
        <div className="relative bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-6 pb-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
          
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative"
          >
            <DialogHeader className="text-left">
              <DialogTitle className="text-2xl font-bold text-foreground">
                Training beendet! 🎉
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {workoutName} • {format(selectedDate, 'EEEE, dd. MMMM', { locale: de })}
              </p>
            </DialogHeader>
          </motion.div>
          
          {/* Completion badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4, type: "spring" }}
            className="absolute top-4 right-4"
          >
            <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
              completionPercent === 100 
                ? 'bg-primary/20 text-primary' 
                : 'bg-amber-500/20 text-amber-500'
            }`}>
              {completionPercent}%
            </div>
          </motion.div>
        </div>

        {/* Stats Grid */}
        <div className="p-6 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={<Clock className="w-4 h-4" />}
              label="Trainingsdauer"
              value={formatDurationLong(duration)}
              unit="min"
              delay={0.1}
            />
            <StatCard
              icon={<Weight className="w-4 h-4" />}
              label="Bewegtes Gewicht"
              value={stats.totalVolume.toLocaleString('de-DE')}
              unit="kg"
              delay={0.15}
            />
            <StatCard
              icon={<Dumbbell className="w-4 h-4" />}
              label="Übungen"
              value={`${stats.exercisesCompleted}/${stats.totalExercises}`}
              delay={0.2}
            />
            <StatCard
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Sätze"
              value={`${stats.completedSets}/${stats.totalSets}`}
              delay={0.25}
            />
          </div>

          {/* Total Reps - Full width */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="relative overflow-hidden rounded-xl bg-primary/10 border border-primary/20 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/20">
                  <Repeat className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Wiederholungen gesamt</p>
                  <p className="text-2xl font-bold text-foreground">{stats.totalReps.toLocaleString('de-DE')}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Footer */}
        <DialogFooter className="p-6 pt-2 flex-col gap-2">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            className="w-full"
          >
            <Button 
              onClick={onClose} 
              className="w-full h-12 text-base font-semibold"
              size="lg"
            >
              Schließen
            </Button>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="w-full"
          >
            <Button 
              variant="ghost" 
              className="w-full text-muted-foreground hover:text-foreground"
              disabled
            >
              Details anzeigen
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </motion.div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WorkoutSummaryModal;
