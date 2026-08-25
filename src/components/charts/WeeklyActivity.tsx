import React, { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, Flame } from "lucide-react";
import { useWeeklyActivity, ViewMode } from "@/hooks/useWeeklyActivity";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";

interface WeeklyActivityProps {
  className?: string;
}

export const WeeklyActivity: React.FC<WeeklyActivityProps> = ({ className }) => {
  const { t } = useTranslation();
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
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-semibold text-foreground truncate">
          Aktivitätsfortschritt
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="h-8 w-8 rounded-full flex-shrink-0 transition-transform"
            asChild
            aria-label="Aktualisieren"
          >
            <motion.button
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.1 }}
            >
              <RefreshCw className="h-4 w-4" />
            </motion.button>
          </Button>
        </div>
      </div>

      {/* View Toggle - Full Width Responsive */}
      <div className="flex w-full bg-muted/50 rounded-full p-1 mb-4">
        <motion.button
          onClick={() => setViewMode("weekly")}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "flex-1 text-xs px-3 py-1.5 rounded-full transition-all whitespace-nowrap",
            viewMode === "weekly"
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Wöchentlich
        </motion.button>
        <motion.button
          onClick={() => setViewMode("monthly")}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "flex-1 text-xs px-3 py-1.5 rounded-full transition-all whitespace-nowrap",
            viewMode === "monthly"
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Monatlich
        </motion.button>
      </div>

      {/* Chart - Vertical Daily Bars */}
      <div className="flex items-end justify-between gap-1.5 mb-4 relative">
        {/* Zero State Overlay */}
        {totalMinutes === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-2 rounded-lg bg-background/50 backdrop-blur-[2px] transition-all duration-500">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="flex flex-col items-center text-center space-y-2 max-w-[180px]"
            >
              <div className="p-2 rounded-full bg-primary/10 mb-1">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('dashboard.weeklyActivity.empty.title', 'Noch keine Aktivität')}
              </h3>
              <p className="text-xs text-muted-foreground leading-tight">
                {t('dashboard.weeklyActivity.empty.description', 'Starte ein Training, um deinen Balken zu füllen!')}
              </p>
            </motion.div>
          </div>
        )}

        {dailyData.map((value, index) => {
          // Calculate height proportional to actual minutes (0-60min range typically)
          const heightPercentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

          // Determine bar color based on activity level
          let barColor = "bg-muted"; // Gray for 0min
          if (value >= 30) {
            barColor = "bg-success"; // Green for ≥30min
          } else if (value > 0) {
            barColor = "bg-warning"; // Yellow for >0 but <30min
          }

          // Muted appearance if total is 0 (behind overlay)
          if (totalMinutes === 0) {
            barColor = "bg-muted/50";
          }

          return (
            <div key={dayLabels[index]} className="flex flex-col items-center flex-1 gap-1.5 group">
              {/* Gray Track Container with Fixed Height */}
              <div className="w-full h-32 bg-muted/30 rounded-lg flex flex-col justify-end overflow-hidden relative">
                {/* Colored Fill Bar */}
                <div
                  className={cn(
                    "w-full rounded-lg relative transition-all duration-500",
                    barColor
                  )}
                  style={{
                    height: value > 0 ? `${Math.max(heightPercentage, 8)}%` : '4px',
                    minHeight: '4px',
                    transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'height 0.6s ease-out'
                  }}
                >
                  {/* Subtle gradient overlay */}
                  {value > 0 && (
                    <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/10" />
                  )}
                </div>

                {/* Tooltip on hover */}
                {value > 0 && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    {value} min
                  </div>
                )}
              </div>

              {/* Day Label */}
              <span className="text-[10px] text-muted-foreground font-medium">
                {dayLabels[index]}
              </span>
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