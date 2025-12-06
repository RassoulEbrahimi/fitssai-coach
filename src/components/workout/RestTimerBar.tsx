import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Timer, SkipForward, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRestTime } from "@/lib/restTimeParser";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface RestTimerBarProps {
  remainingSeconds: number;
  totalSeconds: number;
  isComplete: boolean;
  onSkip: () => void;
}

export const RestTimerBar: React.FC<RestTimerBarProps> = ({
  remainingSeconds,
  totalSeconds,
  isComplete,
  onSkip,
}) => {
  // Reversed: starts at 100% and drains to 0%
  const progressPercent = totalSeconds > 0 
    ? Math.round((remainingSeconds / totalSeconds) * 100) 
    : 0;

  return (
    <AnimatePresence mode="wait">
      {isComplete ? (
        <motion.div
          key="complete"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={cn(
            "flex items-center justify-center gap-2 p-3 rounded-lg",
            "bg-primary/20 border border-primary/30"
          )}
        >
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span className="font-semibold text-primary">Weiter geht's!</span>
        </motion.div>
      ) : (
        <motion.div
          key="timer"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={cn(
            "p-3 rounded-lg space-y-2",
            "bg-muted/50 border border-border"
          )}
        >
          {/* Timer header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Pause</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-primary tabular-nums">
                {formatRestTime(remainingSeconds)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSkip}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Überspringen"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          {/* Progress bar */}
          <Progress 
            value={progressPercent} 
            className="h-2 bg-muted"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RestTimerBar;
