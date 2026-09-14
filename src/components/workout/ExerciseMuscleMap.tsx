import type { ExerciseDetail, MuscleGroup } from '@/lib/exerciseGuidance';

// Deliberately schematic: text lists supply the precise muscle names, including deep muscles.
const regions: { groups: MuscleGroup[]; back?: boolean; d: string }[] = [
  { groups: ['chest'], d: 'M40 57 Q54 50 68 57 L66 76 L42 76 Z' },
  { groups: ['frontShoulders', 'shoulderStabilizers'], d: 'M38 54 L31 56 L26 73 L35 77 Z M70 54 L77 56 L82 73 L73 77 Z' },
  { groups: ['biceps'], d: 'M27 79 L34 81 L31 100 L23 98 Z M74 81 L81 79 L85 98 L77 100 Z' },
  { groups: ['abs', 'deepAbs'], d: 'M46 80 L62 80 L62 110 L46 110 Z' },
  { groups: ['obliques'], d: 'M38 81 L43 83 L43 109 L38 113 Z M65 83 L70 81 L70 113 L65 109 Z' },
  { groups: ['upperBack'], back: true, d: 'M40 56 L68 56 L63 76 L45 76 Z' },
  { groups: ['lats'], back: true, d: 'M38 76 L48 80 L51 107 L43 103 Z M60 80 L70 76 L65 103 L57 107 Z' },
  { groups: ['triceps'], back: true, d: 'M27 77 L35 79 L31 101 L23 99 Z M73 79 L81 77 L85 99 L77 101 Z' },
  { groups: ['shoulderStabilizers'], back: true, d: 'M31 56 L38 54 L35 74 L26 71 Z M70 54 L77 56 L82 71 L73 74 Z' },
];

export default function ExerciseMuscleMap({ muscles }: { muscles: ExerciseDetail['muscles'] }) {
  return (
    <figure className="rounded-xl border bg-muted/30 p-3">
      <svg viewBox="0 0 240 218" className="mx-auto h-56 w-full max-w-xs" role="img" aria-label="Schematische Muskelübersicht von vorne und hinten. Ausgefüllt: primär; umrandet: sekundär.">
        {[false, true].map(back => (
          <g key={String(back)} transform={`translate(${back ? 126 : 6} 0)`}>
            <g className="fill-muted stroke-muted-foreground" strokeWidth="1.5">
              <circle cx="54" cy="28" r="15" />
              <path d="M46 43 L46 50 L31 54 Q25 55 23 67 L13 116 Q12 124 19 124 L34 85 L37 116 L35 147 L32 191 Q32 197 43 196 L54 143 L65 196 Q76 197 76 191 L73 147 L71 116 L74 85 L89 124 Q96 124 95 116 L85 67 Q83 55 77 54 L62 50 L62 43" />
            </g>
            {regions.filter(region => Boolean(region.back) === back).map((region, index) => {
              const primary = region.groups.some(group => muscles.primary.includes(group));
              const secondary = region.groups.some(group => muscles.secondary.includes(group));
              if (!primary && !secondary) return null;
              return <path key={index} d={region.d} className={primary ? 'fill-primary stroke-primary' : 'fill-background stroke-primary'} strokeWidth="2.5" />;
            })}
            <text x="54" y="214" textAnchor="middle" className="fill-muted-foreground text-[11px]">{back ? 'Hinten' : 'Vorne'}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-xs text-muted-foreground">
        Ausgefüllt: Primär · Umrandet: Sekundär<br />
        Vereinfachte Regionen. Maßgeblich sind die Muskellisten.
      </figcaption>
    </figure>
  );
}
