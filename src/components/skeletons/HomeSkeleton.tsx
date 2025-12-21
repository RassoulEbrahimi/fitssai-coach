import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

const HomeSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header Skeleton (Greeting + Avatar) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-full opacity-50" />
        </div>
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>

      {/* Quote Card Skeleton (GradientCard) */}
      <div className="relative">
        <Card className="rounded-3xl border-primary/10 overflow-hidden h-[140px]">
          <CardContent className="p-6 h-full flex flex-col justify-center gap-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-32 mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Progress Rows Skeleton */}
      <div className="space-y-3">
        {/* Workout Row */}
        <div className="flex items-center justify-between p-4 bg-muted/20 rounded-2xl ring-1 ring-border/50 h-[80px]">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
        {/* Nutrition Row */}
        <div className="flex items-center justify-between p-4 bg-muted/20 rounded-2xl ring-1 ring-border/50 h-[80px]">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>

      {/* Weekly Activity Skeleton */}
      <div className="bg-card rounded-3xl p-4 ring-1 ring-border/50 shadow-lg h-[300px] flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <Skeleton className="h-8 w-full rounded-full mb-6" /> {/* Filter toggle */}
        <div className="flex items-end justify-between gap-2 flex-1 pb-2">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-lg" style={{ height: `${30 + Math.random() * 50}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default HomeSkeleton;