import { Timer, ChevronUp } from 'lucide-react';
import { formatRestCountdown } from '@/lib/restTimeParser';

interface RestTimerBarProps {
  remainingSeconds: number;
  setNumber: number;
  isPaused: boolean;
  onOpen: () => void;
}

export default function RestTimerBar({ remainingSeconds, setNumber, isPaused, onOpen }: RestTimerBarProps) {
  return (
    <button
      type="button"
      data-rest-inline
      onClick={onOpen}
      aria-label={`Pause für Satz ${setNumber} öffnen`}
      className="flex min-h-14 w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Timer className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm font-medium">
        {isPaused ? 'Pausiert' : 'Pause'} <span className="block text-xs text-muted-foreground">Satz {setNumber}</span>
      </span>
      <span role="timer" aria-live="off" aria-label={`${remainingSeconds} Sekunden verbleibend`} className="text-2xl font-bold tabular-nums">
        {formatRestCountdown(remainingSeconds)}
      </span>
      <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
  );
}
