import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const MotivationSkeleton: React.FC = () => {
  return (
    <div className="relative overflow-hidden rounded-3xl p-6 border">
      {/* Decorative circles */}
      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-muted/20" />
      <div className="absolute top-1/2 -left-8 w-12 h-12 rounded-full bg-muted/10" />
      <div className="absolute bottom-4 right-1/3 w-8 h-8 rounded-full bg-muted/15" />
      
      <div className="relative z-10 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-24 mt-4" />
      </div>
    </div>
  );
};