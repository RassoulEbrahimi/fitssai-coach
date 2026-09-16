import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const DEFAULT_MAX = 100

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max, ...props }, ref) => {
  const limit = typeof max === "number" && max > 0 ? max : DEFAULT_MAX
  // Radix rejects values outside 0..max as indeterminate, so an overshoot
  // (more sets logged than planned) is drawn and announced as full instead.
  const bounded = typeof value === "number" && !Number.isNaN(value)
    ? Math.min(Math.max(value, 0), limit)
    : null
  const percent = bounded === null ? 0 : (bounded * 100) / limit

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={bounded}
      max={limit}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
