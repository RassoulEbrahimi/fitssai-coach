import { Skeleton } from "@/components/ui/skeleton";

export const SectionSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-48" />
    <div className="space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
    <div className="grid gap-4">
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  </div>
);

export const WorkoutSkeleton = () => (
  <div className="space-y-6">
    {/* Today's workout skeleton */}
    <Skeleton className="h-40 w-full rounded-lg" />
    
    {/* Progress skeleton */}
    <div className="space-y-2">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
    
    {/* Week navigation skeleton */}
    <div className="flex gap-2">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-8 w-20" />
      ))}
    </div>
    
    {/* Exercise rows skeleton */}
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="ml-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const NutritionSkeleton = () => (
  <div className="space-y-6">
    {/* Header skeleton */}
    <Skeleton className="h-8 w-48" />
    
    {/* Meal sections skeleton */}
    {[...Array(3)].map((_, mealIndex) => (
      <div key={mealIndex} className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex justify-between items-center p-4 border rounded-lg">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-6 w-16 ml-3" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const ProfileSkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center space-x-4 p-6 border rounded-lg">
      <Skeleton className="h-16 w-16 rounded-full" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  </div>
);