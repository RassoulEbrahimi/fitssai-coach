import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Timer, SkipForward, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRestTime } from "@/lib/restTimeParser";
import { Button } from "@/components/ui/button";

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
  // Progress as percentage (100% -> 0% as time runs out)
  const progressPercent = totalSeconds > 0 
    ? (remainingSeconds / totalSeconds) * 100 
    : 0;

  const isUrgent = remainingSeconds <= 10 && remainingSeconds > 0;

  // Smooth transition spring config
  const contentTransition = {
    type: "spring" as const,
    stiffness: 500,
    damping: 30,
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-muted/30 backdrop-blur-sm">
      {/* Fluid background progress */}
      <div 
        className={cn(
          "absolute inset-0 origin-left",
          isUrgent 
            ? "bg-amber-500/20" 
            : "bg-primary/15"
        )}
        style={{ 
          width: `${progressPercent}%`,
          transition: "width 1s linear, background-color 0.3s ease"
        }}
      />
      
      {/* Content layer */}
      <div className="relative z-10 px-4 py-3">
        <AnimatePresence mode="wait">
          {isComplete ? (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
              transition={contentTransition}
              className="flex items-center justify-center gap-3 py-1"
            >
              <motion.div
                initial={{ rotate: -180, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ ...contentTransition, delay: 0.1 }}
              >
                <Zap className="w-5 h-5 text-primary fill-primary/30" />
              </motion.div>
              <span className="font-semibold text-primary text-lg">
                Weiter geht's!
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="timer"
              initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
              transition={contentTransition}
              className="flex items-center"
            >
              {/* Left: Icon + Label */}
              <div className="flex-1 flex items-center gap-2">
                <Timer className={cn(
                  "w-4 h-4 transition-colors",
                  isUrgent ? "text-amber-400" : "text-primary"
                )} />
                <span className="text-sm font-medium text-muted-foreground">
                  Pause
                </span>
              </div>
              
              {/* Center: Timer countdown */}
              <div className="flex-1 flex justify-center">
                <motion.span 
                  className={cn(
                    "text-xl font-bold tabular-nums tracking-tight",
                    isUrgent 
                      ? "text-amber-400" 
                      : "text-foreground"
                  )}
                  animate={isUrgent ? { 
                    scale: [1, 1.05, 1],
                  } : {}}
                  transition={{ 
                    duration: 0.5, 
                    repeat: isUrgent ? Infinity : 0,
                    ease: "easeInOut"
                  }}
                >
                  {formatRestTime(remainingSeconds)}
                </motion.span>
              </div>
              
              {/* Right: Skip button */}
              <div className="flex-1 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSkip}
                  className={cn(
                    "h-8 w-8 rounded-full",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-foreground/10 transition-colors"
                  )}
                  aria-label="Überspringen"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default RestTimerBar;
