import { useState } from 'react';
import { exerciseThumbnailFallback, resolveExercisePresentation } from '@/lib/exercisePresentation';

/** Decorative beside the authoritative name. Dimensions remain fixed on load/error. */
export default function ExerciseThumbnail({ name }: { name: string }) {
  const presentation = resolveExercisePresentation(name);
  const src = presentation?.thumbnail?.src;
  const [failedSource, setFailedSource] = useState<string>();
  const fallback = exerciseThumbnailFallback(name);
  return (
    <span aria-hidden="true" data-exercise-thumbnail data-identity={fallback.identity}
      className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted text-foreground">
      {src && failedSource !== src ? (
        // The artwork is drawn for the light surface; dark mode inverts it, which
        // lifts the neutral ink off the dark tile and keeps the accent green.
        <img key={src} src={src} alt="" width={72} height={72} loading="lazy" decoding="async"
          className="h-full w-full object-contain dark:invert dark:hue-rotate-180"
          onError={() => setFailedSource(src)} />
      ) : (
        <>
          <svg viewBox="0 0 72 72" className="absolute inset-0 h-full w-full text-primary" fill="currentColor">
            <path d="M0 0h72v72H0z" opacity=".06" />
            {Array.from({ length: 32 }, (_, bit) => (
              <rect key={bit} x={5 + (bit % 8) * 8} y={bit < 16 ? 5 + Math.floor(bit / 8) * 8 : 53 + Math.floor((bit - 16) / 8) * 8}
                width="5" height="5" rx="1.5" opacity={(fallback.pattern >>> bit) & 1 ? '.45' : '.08'} />
            ))}
          </svg>
          <span className="relative text-xl font-semibold tracking-tight">{fallback.initials}</span>
        </>
      )}
    </span>
  );
}
