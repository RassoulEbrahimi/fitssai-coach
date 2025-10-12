import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressRingProps {
  size?: number;          // default 56px
  strokeWidth?: number;   // default 6px
  progress: number;       // 0..100
  trackClassName?: string;
  progressClassName?: string;
  className?: string;
  children?: React.ReactNode; // optional label inside (e.g. "75%")
}

const ProgressRing: React.FC<ProgressRingProps> = ({
  size = 56,
  strokeWidth = 6,
  progress,
  trackClassName,
  progressClassName,
  className,
  children,
}) => {
  const clamped = Math.max(0, Math.min(100, progress || 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }} // start at 12 o'clock
        className="block"
        role="img"
        aria-label={`Progress ${clamped}%`}
      >
        <circle
          cx={size/2}
          cy={size/2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn('text-muted-foreground/20', trackClassName)}
          stroke="currentColor"
        />
        <circle
          cx={size/2}
          cy={size/2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={cn('text-emerald-500', progressClassName)}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-semibold">
        {children}
      </div>
    </div>
  );
};

export default ProgressRing;
