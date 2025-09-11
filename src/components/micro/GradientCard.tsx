import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GradientCardProps {
  children: React.ReactNode;
  className?: string;
}

export const GradientCard: React.FC<GradientCardProps> = ({ children, className }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className={cn(
        "relative overflow-hidden rounded-3xl p-6",
        "bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5",
        "dark:from-primary/30 dark:via-primary/20 dark:to-primary/10",
        "border border-primary/20 dark:border-primary/30",
        "shadow-lg shadow-primary/10 dark:shadow-primary/20",
        "backdrop-blur-sm",
        className
      )}
    >
      {/* Decorative circles */}
      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-primary/10 dark:bg-primary/20 animate-pulse" />
      <div className="absolute top-1/2 -left-8 w-12 h-12 rounded-full bg-primary/5 dark:bg-primary/15" />
      <div className="absolute bottom-4 right-1/3 w-8 h-8 rounded-full bg-primary/15 dark:bg-primary/25" />
      
      {/* Inner highlight */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-transparent via-white/5 to-white/10 dark:via-white/2 dark:to-white/5" />
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
};