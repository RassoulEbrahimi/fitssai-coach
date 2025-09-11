import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface WeeklyActivityProps {
  data: Array<{ day: string; value: number }>;
  className?: string;
}

export const WeeklyActivity: React.FC<WeeklyActivityProps> = ({ data, className }) => {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className={cn(
        "bg-card rounded-2xl p-4 border shadow-card",
        className
      )}
    >
      <h2 className="text-lg font-semibold mb-4 text-foreground">
        Aktivitätsfortschritt
      </h2>
      
      <div className="flex items-end justify-between gap-2 h-32">
        {data.map((item, index) => {
          const heightPercentage = (item.value / maxValue) * 100;
          const isActive = item.value > 0;
          
          return (
            <div key={item.day} className="flex flex-col items-center flex-1">
              <motion.div
                className={cn(
                  "w-full rounded-t-lg relative overflow-hidden",
                  "bg-gradient-to-t transition-all duration-300",
                  isActive 
                    ? "from-primary/60 to-primary shadow-sm shadow-primary/20" 
                    : "from-muted/40 to-muted/20"
                )}
                initial={{ height: 0 }}
                animate={{ 
                  height: `${Math.max(heightPercentage, 8)}%` // Minimum 8% for visibility
                }}
                transition={{ 
                  duration: 0.6, 
                  delay: index * 0.1,
                  ease: "easeOut"
                }}
                style={{
                  "@media (prefers-reduced-motion: reduce)": {
                    transition: "none"
                  }
                } as React.CSSProperties}
              >
                {/* Glass effect overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/10 to-white/20 dark:via-white/5 dark:to-white/10" />
              </motion.div>
              
              <span className="text-xs text-muted-foreground mt-2 font-medium">
                {item.day}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};