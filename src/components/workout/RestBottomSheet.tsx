import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Pause, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { formatRestCountdown, getRestAnnouncement } from '@/lib/restTimeParser';
import { isFocusableElement } from '@/hooks/useFocusModeContainment';
import type { RestTimerController } from '@/hooks/useRestTimer';
import type { ExecutionExercise } from '@/lib/workoutExecution';

export default function RestBottomSheet({ rest, exercises }: {
  rest: RestTimerController;
  exercises: ExecutionExercise[];
}) {
  const { timerState: timer, isSheetOpen, setSheetOpen } = rest;
  const returnFocus = useRef<Element | null>(null);
  const paused = timer.status === 'paused';
  const announcement = timer.status === 'running' || timer.isComplete
    ? getRestAnnouncement(timer.remainingSeconds, timer.isComplete) : null;
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {!isSheetOpen ? announcement : null}
      </div>
      <Dialog.Root open={isSheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100000] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <Dialog.Content
            className="fixed inset-x-0 bottom-0 z-[100001] mx-auto w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-border bg-background p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
            onOpenAutoFocus={() => { returnFocus.current = document.activeElement; }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const inline = document.querySelector<HTMLButtonElement>('[data-rest-inline]');
              const target = isFocusableElement(inline) ? inline : returnFocus.current;
              if (isFocusableElement(target)) target.focus({ preventScroll: true });
            }}
          >
            <SheetTitle className="px-10 text-center">Pause</SheetTitle>
            <SheetDescription className="mt-1 px-8 text-center break-words">
              {timer.exerciseIndex !== null ? exercises[timer.exerciseIndex]?.name : ''} · Satz {timer.setNumber}
            </SheetDescription>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="absolute right-3 top-3 h-11 w-11 rounded-full" aria-label="Pause schließen">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
            <div role="timer" aria-live="off" aria-label={`${timer.remainingSeconds} Sekunden verbleibend`} className="my-6 text-center text-6xl font-bold tracking-tight tabular-nums">
              {formatRestCountdown(timer.remainingSeconds)}
            </div>
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
            <p className="mb-3 text-center text-sm text-muted-foreground">{paused ? 'Pausiert' : 'Zeit zum Durchatmen'}</p>
            <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-2">
              <Button variant="outline" className="h-12 px-2" onClick={() => rest.adjustTimer(-15)} aria-label="Pause um 15 Sekunden verkürzen">−15 s</Button>
              <Button className="h-12 gap-2 px-2" onClick={paused ? rest.resumeTimer : rest.pauseTimer} aria-label={paused ? 'Pause fortsetzen' : 'Timer pausieren'}>
                {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
                {paused ? 'Weiter' : 'Pause'}
              </Button>
              <Button variant="outline" className="h-12 px-2" onClick={() => rest.adjustTimer(15)} aria-label="Pause um 15 Sekunden verlängern">+15 s</Button>
            </div>
            <Button variant="ghost" className="mt-3 h-12 w-full" onClick={rest.skipTimer}>Pause überspringen</Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
