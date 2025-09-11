import React from "react";
import { cn } from "@/lib/utils";

interface ProgressPillProps {
  value: number;
  className?: string;
  "aria-label"?: string;
}

export const ProgressPill: React.FC<ProgressPillProps> = ({ 
  value, 
  className, 
  "aria-label": ariaLabel 
}) => {
  const getColorClasses = (percentage: number) => {
    if (percentage <= 39) {
      return "bg-muted text-muted-foreground border-muted";
    } else if (percentage <= 79) {
      return "bg-primary/20 text-primary border-primary/30 dark:bg-primary/30";
    } else {
      return "bg-success/20 text-success border-success/30 dark:bg-success/30";
    }
  };

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center",
        "px-3 py-1.5 rounded-full border text-xs font-medium",
        "min-w-[60px] transition-colors duration-200",
        getColorClasses(value),
        className
      )}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      {value}%
    </div>
  );
};