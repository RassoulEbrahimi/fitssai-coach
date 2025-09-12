import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface WeeklyActivityProps {
  data: number[]; // Array of 7 values (0-100) for Mon-Sun
  className?: string;
}

export const WeeklyActivity: React.FC<WeeklyActivityProps> = ({ data, className }) => {
  const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const maxValue = Math.max(...data, 1);

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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Aktivitätsfortschritt
        </h2>
        <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
          Wöchentlich
        </span>
      </div>
      
      <div className="flex items-end justify-between gap-2 h-32">
        {data.map((value, index) => {
          const heightPercentage = Math.max((value / maxValue) * 100, 8); // Minimum 8% for visibility
          const isActive = value > 30;
          
          return (
            <div key={dayLabels[index]} className="flex flex-col items-center flex-1">
              <div
                className={cn(
                  "w-full rounded-full relative overflow-hidden transition-all duration-500",
                  "bg-gradient-to-t",
                  isActive 
                    ? "from-primary/60 to-primary shadow-sm shadow-primary/20" 
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
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};