import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GradientCardProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export const GradientCard: React.FC<GradientCardProps> = ({ title, subtitle, children, className }) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, delay: prefersReducedMotion ? 0 : 0.1 }}
      className={cn(
        "relative overflow-hidden rounded-3xl p-4",
        "bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-violet-500/5",
        "dark:from-emerald-500/30 dark:via-teal-500/20 dark:to-cyan-500/10",
        "ring-1 ring-border/50",
        "shadow-xl",
        "backdrop-blur-sm",
        className
      )}
    >
      {/* Decorative circles - static for performance */}
      <div className={cn(
        "absolute -top-4 -right-4 w-16 h-16 rounded-full bg-indigo-500/10 dark:bg-emerald-500/20",
        !prefersReducedMotion && "animate-pulse"
      )} 
      style={{ animationDuration: '3s' }}
      />
      <div className="absolute top-1/2 -left-8 w-12 h-12 rounded-full bg-purple-500/5 dark:bg-teal-500/15" />
      <div className="absolute bottom-4 right-1/3 w-8 h-8 rounded-full bg-violet-500/15 dark:bg-cyan-500/25" />
      
      {/* Inner highlight */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-transparent via-white/5 to-white/10 dark:via-white/2 dark:to-white/5" />
      
      {/* Content */}
      <div className="relative z-10">
        {title && (
          <h2 className="text-sm font-medium text-primary/80 mb-2">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mb-3">
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </motion.div>
  );
};