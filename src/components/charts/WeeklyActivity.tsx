import React, { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, Flame } from "lucide-react";
import { useWeeklyActivity, ViewMode } from "@/hooks/useWeeklyActivity";
import { Skeleton } from "@/components/ui/skeleton";

interface WeeklyActivityProps {
  className?: string;
}

export const WeeklyActivity: React.FC<WeeklyActivityProps> = ({ className }) => {
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const { dailyData, dayLabels, activeDays, totalMinutes, targetMinutes, isLoading, refresh } = useWeeklyActivity(viewMode);
  
  const maxValue = Math.max(...dailyData, 1);
  const progressPercentage = (totalMinutes / targetMinutes) * 100;
  const isTargetAchieved = totalMinutes >= targetMinutes;
  const totalDays = viewMode === "weekly" ? 7 : 30;

  if (isLoading) {
    return (
      <div className={cn("bg-card rounded-3xl p-4 ring-1 ring-border/50 shadow-lg", className)}>
        <Skeleton className="h-6 w-48 mb-4" />
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className={cn(
        "bg-card rounded-3xl p-4 ring-1 ring-border/50 shadow-lg",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Aktivitätsfortschritt
        </h2>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center bg-muted/50 rounded-full p-1">
            <button
              onClick={() => setViewMode("weekly")}
              className={cn(
                "text-xs px-3 py-1 rounded-full transition-all",
                viewMode === "weekly" 
                  ? "bg-primary text-primary-foreground font-medium" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Wöchentlich
            </button>
            <button
              onClick={() => setViewMode("monthly")}
              className={cn(
                "text-xs px-3 py-1 rounded-full transition-all",
                viewMode === "monthly" 
                  ? "bg-primary text-primary-foreground font-medium" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monatlich
            </button>
          </div>
          
          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="h-8 w-8 rounded-full"
            aria-label="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Chart */}
      <div className="flex items-end justify-between gap-1.5 h-32 mb-4">
        {dailyData.map((value, index) => {
          const heightPercentage = Math.max((value / maxValue) * 100, 8);
          const isActive = value >= 30;
          
          return (
            <div key={dayLabels[index]} className="flex flex-col items-center flex-1 group">
              <div
                className={cn(
                  "w-full rounded-full relative overflow-hidden transition-all duration-500",
                  "bg-gradient-to-t",
                  isActive 
                    ? "from-success/60 to-success shadow-sm shadow-success/20" 
                    : "from-muted/40 to-muted/20"
                )}
                style={{
                  height: `${heightPercentage}%`,
                  transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'height 0.6s ease-out'
                }}
              >
                {/* Glass effect overlay */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/10 to-white/20 dark:via-white/5 dark:to-white/10" />
              </div>
              
              <span className="text-xs text-muted-foreground mt-2 font-medium">
                {dayLabels[index]}
              </span>
              
              {/* Tooltip on hover */}
              {value > 0 && (
                <div className="absolute -top-8 bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                  {value} min
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress Summary */}
      <div className="space-y-3">
        {/* Stats Row */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{activeDays}</span> von {totalDays} Tagen aktiv
          </span>
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{totalMinutes}</span> von {targetMinutes} min
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted/30 rounded-full h-2 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(progressPercentage, 100)}%` }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className={cn(
              "h-full rounded-full transition-all",
              isTargetAchieved 
                ? "bg-gradient-to-r from-success to-success/80" 
                : "bg-gradient-to-r from-primary to-primary/80"
            )}
          />
        </div>

        {/* Motivational Message */}
        <div className="flex items-center justify-center gap-2 pt-1">
          {isTargetAchieved ? (
            <>
              <Flame className="h-4 w-4 text-success" aria-hidden="true" />
              <span className="text-sm font-medium text-success">Strong week!</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              Keep pushing, tomorrow counts!
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};