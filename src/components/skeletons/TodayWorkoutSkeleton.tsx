import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TodayWorkoutSkeletonProps {
  title?: string;
  titleClassName?: string;
}

export const TodayWorkoutSkeleton = ({ title, titleClassName }: TodayWorkoutSkeletonProps) => (
  <Card className="border-border">
    <CardHeader className="pb-4">
      {title && <CardTitle className={titleClassName}>{title}</CardTitle>}
    </CardHeader>
    <CardContent>
      <div className="space-y-3">
        <div className="h-4 bg-muted animate-pulse rounded" />
        <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 bg-muted animate-pulse rounded" />
              <div className="flex-1 h-4 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </CardContent>
  </Card>
);
