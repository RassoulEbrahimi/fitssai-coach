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

/**
 * Optimized skeleton for workout tab - matches above-the-fold content structure
 */
export const WorkoutSkeleton = () => (
  <div className="space-y-6" style={{ minHeight: '60vh' }}>
    {/* Today's workout skeleton - matches card height */}
    <div className="space-y-4">
      <Skeleton className="h-6 w-32" />
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
    
    {/* Progress skeleton */}
    <div className="space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-2 w-full" />
      
      {/* Week navigation skeleton */}
      <div className="flex gap-2 pt-2">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded" />
        ))}
      </div>
    </div>
    
    {/* Week accordion skeleton */}
    <div className="space-y-3">
      <div className="border rounded-lg">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-5 w-12" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Optimized skeleton for nutrition tab - matches meal card structure
 */
export const NutritionSkeleton = () => (
  <div className="space-y-6" style={{ minHeight: '60vh' }}>
    {/* Header skeleton */}
    <div className="border rounded-lg">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-32" />
        </div>
      </div>
      <div className="p-4 space-y-6">
        {/* Meal sections skeleton */}
        {[...Array(3)].map((_, mealIndex) => (
          <div key={mealIndex} className="space-y-3">
            <Skeleton className="h-6 w-24" />
            <div className="grid gap-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                    <Skeleton className="h-6 w-16 ml-3 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Optimized skeleton for profile tab - matches ProfileCard structure
 */
export const ProfileSkeleton = () => (
  <div className="space-y-4" style={{ minHeight: '60vh' }}>
    <div className="border rounded-lg">
      {/* Profile header */}
      <div className="p-6 border-b">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
      
      {/* Profile content */}
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
        
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
        </div>
        
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  </div>
);