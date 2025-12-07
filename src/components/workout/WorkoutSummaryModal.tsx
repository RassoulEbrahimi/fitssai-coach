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
  frozenDuration: number; // Frozen duration in seconds (captured at finish click)
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

interface StatRowProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  delay?: number;
  isLast?: boolean;
}

const StatRow: React.FC<StatRowProps> = ({ icon, label, value, unit, delay = 0, isLast = false }) => (
  <motion.div
    initial={{ opacity: 0, x: -10 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.3 }}
    className={`flex items-center justify-between py-3.5 ${
      isLast ? '' : 'border-b border-border/30'
    }`}
  >
    <div className="flex items-center gap-3 text-muted-foreground">
      <div className="p-1.5 rounded-md bg-muted/50">
        {icon}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
    <span className="text-base font-semibold text-foreground whitespace-nowrap">
      {value}{unit && <span className="text-muted-foreground font-normal ml-1">{unit}</span>}
    </span>
  </motion.div>
);

const WorkoutSummaryModal: React.FC<WorkoutSummaryModalProps> = ({
  open,
  onClose,
  exercises,
  frozenDuration,
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
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[99999] bg-black/70 backdrop-blur-md" />
        <DialogContent className="sm:max-w-md z-[100000] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-primary/20 via-primary/10 to-transparent px-6 pt-6 pb-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
          
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative text-center"
          >
            <DialogHeader>
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
            className="flex justify-center mt-3"
          >
            <div className={`px-4 py-1.5 rounded-full text-sm font-semibold ${
              completionPercent === 100 
                ? 'bg-primary/20 text-primary' 
                : 'bg-amber-500/20 text-amber-500'
            }`}>
              {completionPercent}% abgeschlossen
            </div>
          </motion.div>
        </div>

        {/* Stats List */}
        <div className="px-6 py-4">
          <StatRow
            icon={<Clock className="w-4 h-4" />}
            label="Trainingsdauer"
            value={formatDurationLong(frozenDuration)}
            unit="min"
            delay={0.1}
          />
          <StatRow
            icon={<Weight className="w-4 h-4" />}
            label="Bewegtes Gewicht"
            value={stats.totalVolume.toLocaleString('de-DE')}
            unit="kg"
            delay={0.15}
          />
          <StatRow
            icon={<Dumbbell className="w-4 h-4" />}
            label="Übungen"
            value={`${stats.exercisesCompleted}/${stats.totalExercises}`}
            delay={0.2}
          />
          <StatRow
            icon={<CheckCircle2 className="w-4 h-4" />}
            label="Sätze"
            value={`${stats.completedSets}/${stats.totalSets}`}
            delay={0.25}
          />
          <StatRow
            icon={<Repeat className="w-4 h-4" />}
            label="Wiederholungen"
            value={stats.totalReps.toLocaleString('de-DE')}
            delay={0.3}
            isLast
          />
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 pb-6 pt-2 flex-col gap-2">
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
      </DialogPortal>
    </Dialog>
  );
};

export default WorkoutSummaryModal;