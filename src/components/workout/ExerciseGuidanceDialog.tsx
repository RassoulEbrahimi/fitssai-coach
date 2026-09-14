import * as Dialog from '@radix-ui/react-dialog';
import { Dumbbell, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { muscleLabels, resolveExerciseDetail } from '@/lib/exerciseGuidance';
import ExerciseMuscleMap from './ExerciseMuscleMap';

const unsupported = 'Für diese Übung sind noch keine Detailinformationen verfügbar.';

/** Owns presentation only. Radix restores focus to this card's persistent Info trigger. */
export default function ExerciseGuidanceDialog({ exerciseName, disabled = false }: {
  exerciseName: string;
  disabled?: boolean;
}) {
  const detail = resolveExerciseDetail(exerciseName);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} className="mr-2 h-11 w-11 shrink-0" aria-label={`Informationen zu ${exerciseName}`}>
          <Info className="h-5 w-5" aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100000] bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100001] flex h-[calc(100dvh-1rem)] max-h-[48rem] w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:h-auto sm:max-h-[90dvh]">
          <div className="shrink-0 px-4 pb-3 pt-5 pr-16 sm:px-6 sm:pr-16">
            <DialogTitle className="break-words leading-snug">{exerciseName}</DialogTitle>
            <DialogDescription className="mt-1">Übungsdetails</DialogDescription>
          </div>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-11 w-11" aria-label="Übungsdetails schließen">
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </Dialog.Close>
          <Tabs defaultValue="execution" className="flex min-h-0 flex-1 flex-col">
            <TabsList aria-label="Übungsinformationen" className="mx-4 grid h-12 shrink-0 grid-cols-2 sm:mx-6">
              <TabsTrigger value="execution" className="h-11 px-2">Ausführung</TabsTrigger>
              <TabsTrigger value="muscles" className="h-11 px-2">Muskelgruppen</TabsTrigger>
            </TabsList>
            <TabsContent value="execution" className="m-0 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              {detail ? (
                <div className="space-y-5 text-sm leading-relaxed">
                  {detail.media ? <img src={detail.media.src} alt={detail.media.alt} className="max-h-48 w-full rounded-lg object-contain" /> : (
                    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 text-muted-foreground">
                      <Dumbbell className="h-6 w-6 shrink-0" aria-hidden="true" />
                      <span>Anleitung ohne Abbildung</span>
                    </div>
                  )}
                  <section><h3 className="mb-2 font-semibold">Vorbereitung</h3><ul className="list-disc space-y-2 pl-5">{detail.execution.setup.map(step => <li key={step}>{step}</li>)}</ul></section>
                  <section><h3 className="mb-2 font-semibold">Ausführung</h3><ol className="list-decimal space-y-2 pl-5">{detail.execution.steps.map(step => <li key={step}>{step}</li>)}</ol></section>
                  {detail.execution.cues?.length ? <section><h3 className="mb-2 font-semibold">Hinweise</h3><ul className="list-disc space-y-2 pl-5">{detail.execution.cues.map(cue => <li key={cue}>{cue}</li>)}</ul></section> : null}
                </div>
              ) : <p className="text-sm text-muted-foreground">{unsupported}</p>}
            </TabsContent>
            <TabsContent value="muscles" className="m-0 min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              {detail ? <>
                <section><h3 className="mb-2 font-semibold">Primär</h3><ul className="list-disc space-y-1 pl-5 text-sm">{detail.muscles.primary.map(muscle => <li key={muscle}>{muscleLabels[muscle]}</li>)}</ul></section>
                <section><h3 className="mb-2 font-semibold">Sekundär</h3><ul className="list-disc space-y-1 pl-5 text-sm">{detail.muscles.secondary.map(muscle => <li key={muscle}>{muscleLabels[muscle]}</li>)}</ul></section>
                <ExerciseMuscleMap muscles={detail.muscles} />
              </> : <p className="text-sm text-muted-foreground">{unsupported}</p>}
            </TabsContent>
          </Tabs>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
