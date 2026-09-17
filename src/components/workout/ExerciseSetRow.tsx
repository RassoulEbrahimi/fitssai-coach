import React, { useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatRestDisplay } from "@/lib/restTimeParser";
import { formatSetTarget, formatSetTargetPlaceholders } from "@/lib/setPrescription";
import { formatPerformancePair, formatPerformanceValues, formatWeightNumber } from "@/lib/setPerformanceEntry";
import {
  setPerformanceFieldId,
  setPerformanceKey,
  type SetPerformanceDraft,
  type SetPerformanceField,
  type SetPerformanceInputs,
} from "@/lib/setPerformanceDrafts";

interface ExerciseSetRowProps {
  /** Position of the exercise in the running day; identifies the performance inputs. */
  exerciseIndex?: number;
  setNumber: number;
  /** The prescription as written in the plan, e.g. 10, "8–12", "30 Sekunden". */
  targetReps?: number | string;
  targetWeight?: string;
  /** The prescribed rest as written in the plan. Shown only; the timer does not read it here. */
  rest?: string;
  isCompleted: boolean;
  isToggling: boolean;
  onToggle: () => void;
  /** What the user recorded as performed. Trusted values only - never the prescription. */
  actual?: { reps: number | null; weightKg: number | null };
  /** When present, the row offers entry of actual reps and weight. */
  performance?: SetPerformanceInputs;
  /** What was recorded for this set last time. A reference only - never today's value. */
  previous?: { reps: number | null; weightKg: number | null } | null;
}

const FIELDS: readonly SetPerformanceField[] = ["reps", "weight"];
const fieldLabel = (field: SetPerformanceField, setNumber: number): string =>
  field === "reps" ? `Wiederholungen für Satz ${setNumber}` : `Gewicht für Satz ${setNumber} in kg`;

const noSubscription = () => () => {};
const noDraft = (): SetPerformanceDraft | undefined => undefined;

/*
  One planned set in a single compact row: its number, today's reps × kg, the
  prescribed rest and completion. The numbers are the largest thing in the row
  and are written straight on the surface - no field boxes, no fills, one
  hairline under a field that is still empty. Placement per card width lives in
  workoutPresentation.css.

  Prescription, actual performance and completion stay separate. The plan's
  target appears only as input placeholders (or written out when it is not a
  plain number), never as a value; the inputs never sit inside the completion
  control, typing never ticks the set, and ticking never copies anything.
*/
export const ExerciseSetRow: React.FC<ExerciseSetRowProps> = ({
  exerciseIndex = 0,
  setNumber,
  targetReps,
  targetWeight,
  rest,
  isCompleted,
  isToggling,
  onToggle,
  actual,
  performance,
  previous,
}) => {
  // The plan's target, shown as written.
  const target = formatSetTarget(targetReps, targetWeight);
  const hints = formatSetTargetPlaceholders(targetReps, targetWeight);
  const restText = formatRestDisplay(rest, { withLabel: true });
  // Names only what was recorded last time; empty hides the reference entirely.
  const previousText = previous ? formatPerformanceValues(previous) : "";
  const previousPair = previous ? formatPerformancePair(previous) : "";
  const key = setPerformanceKey(exerciseIndex, setNumber);
  const draft = useSyncExternalStore(
    performance?.drafts.subscribe ?? noSubscription,
    performance ? () => performance.drafts.get(key) : noDraft,
  );
  const titleId = `set-${exerciseIndex}-${setNumber}-title`;

  const fields = FIELDS.map((name) => {
    const id = setPerformanceFieldId(exerciseIndex, setNumber, name);
    const recorded = name === "reps"
      ? (actual?.reps != null ? String(actual.reps) : "")
      : (actual?.weightKg != null ? formatWeightNumber(actual.weightKg) : "");
    return {
      name,
      id,
      errorId: `${id}-error`,
      value: (name === "reps" ? draft?.reps : draft?.weight) ?? recorded,
      error: name === "reps" ? draft?.repsError : draft?.weightError,
      hint: name === "reps" ? hints.reps : hints.weight,
    };
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.15, delay: setNumber * 0.05 }}
      role="group"
      aria-labelledby={titleId}
      data-completed={isCompleted ? "" : undefined}
      // A row of the exercise, not a card: a flat band, tinted once completed.
      className={cn(
        "workout-set-row py-1 pl-3 transition-colors duration-150 sm:pl-4",
        isCompleted && "bg-primary/[0.06]"
      )}
    >
      <div className="workout-set-grid">
        <span id={titleId} className="workout-set-title text-sm font-semibold tabular-nums text-foreground">
          {setNumber}. Satz
        </span>

        <div className="workout-set-body">
          {performance ? (
            <div className="workout-set-entry flex h-11 items-center">
              {fields.map((field) => (
                <React.Fragment key={field.name}>
                  {field.name === "weight" && (
                    <span aria-hidden="true" className="mx-0.5 text-lg text-muted-foreground">×</span>
                  )}
                  <label htmlFor={field.id} className="sr-only">{fieldLabel(field.name, setNumber)}</label>
                  <Input
                    id={field.id}
                    type="text"
                    inputMode={field.name === "reps" ? "numeric" : "decimal"}
                    enterKeyHint="done"
                    autoComplete="off"
                    spellCheck={false}
                    value={field.value}
                    // The prescription as a hint only; it is never the value.
                    placeholder={field.hint}
                    data-empty={field.value === "" ? "" : undefined}
                    aria-invalid={field.error ? true : undefined}
                    aria-describedby={field.error ? field.errorId : undefined}
                    onChange={(event) => performance.changeDraft(exerciseIndex, setNumber, field.name, event.target.value)}
                    onBlur={() => performance.commit(exerciseIndex, setNumber)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      performance.commit(exerciseIndex, setNumber);
                    }}
                    className={cn(
                      // The number is the row: bigger than the words around it,
                      // and written straight on the surface. No box, no fill,
                      // no rectangle per field (TRAINING-UI-06).
                      "h-11 shrink-0 rounded-none border-x-0 border-t-0 bg-transparent px-0.5",
                      "text-center text-lg font-semibold tabular-nums md:text-lg",
                      // Hints read lighter and smaller than recorded values.
                      "placeholder:text-base placeholder:font-normal",
                      /*
                        The only rule left: a hairline under an empty field, so
                        it still reads as somewhere to type. A filled field
                        carries nothing but its value.
                      */
                      "border-b border-transparent data-[empty]:border-dashed data-[empty]:border-muted-foreground/50",
                      field.name === "reps" ? "w-14" : "w-[4.25rem]",
                      field.error && "border-solid border-destructive text-destructive"
                    )}
                  />
                </React.Fragment>
              ))}
              <span aria-hidden="true" className="ml-1 text-base text-muted-foreground">kg</span>
            </div>
          ) : (
            target.visual && (
              <span className="workout-set-entry text-base font-medium text-foreground">{target.visual}</span>
            )
          )}
          {restText && (
            <span className="workout-set-rest whitespace-nowrap text-sm leading-5 text-muted-foreground">
              <span aria-hidden="true">• </span>{restText}
            </span>
          )}
        </div>

        {performance && (
          <>
            {fields.map((field) => field.error && (
              <p key={field.name} id={field.errorId} role="alert" className="workout-set-detail pb-1 text-xs text-destructive">
                {field.error}
              </p>
            ))}
            {/* A prescription the hints cannot carry (a time, AMRAP, a load in words) is written out. */}
            {!hints.complete && target.visual && (
              <p className="workout-set-detail pb-1 text-xs text-muted-foreground">
                <span className="font-medium">Vorgabe:</span>{" "}
                <span className="text-foreground">{target.visual}</span>
              </p>
            )}
            {/*
              Last time, below today's inputs: a labelled reference, never
              shown inside them. Copying is a separate explicit control that
              fills empty drafts and does nothing else.
            */}
            {previousText && (
              <div className="workout-set-detail mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5">
                <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    <span className="font-medium">Letztes Mal:</span>{" "}
                    {previousPair === previousText ? (
                      <span className="text-foreground">{previousText}</span>
                    ) : (
                      <>
                        {/* Spoken with units; shown as the compact pair. */}
                        <span className="sr-only">{previousText}</span>
                        <span aria-hidden="true" className="text-foreground">{previousPair}</span>
                      </>
                    )}
                  </span>
                </p>
                {performance.copyPrevious && (
                  <button
                    type="button"
                    aria-label={`Übernehmen für Satz ${setNumber}: Letztes Mal ${previousText}`}
                    onClick={() => performance.copyPrevious?.(exerciseIndex, setNumber)}
                    // A real 44px hit box; negative margins keep the line at the 28px face,
                    // and the line's top margin keeps the box clear of the inputs above.
                    // Chromium does not hit-test ::after or children outside a button's box.
                    className="group -my-2 inline-flex h-11 shrink-0 items-center rounded-md focus-visible:outline-none"
                  >
                    <span
                      data-copy-face
                      className={cn(
                        "inline-flex h-7 items-center rounded-md border border-input bg-background px-2",
                        "text-xs font-medium text-foreground transition-colors group-hover:bg-muted"
                      )}
                    >
                      Übernehmen
                    </span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Completion: its own control, with a check shape as well as colour. Last in tab order. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isCompleted}
          aria-label={`Satz ${setNumber}: Vorgabe ${target.spoken} — ${isCompleted ? 'abgeschlossen' : 'offen'}`}
          onClick={onToggle}
          className={cn(
            // 44px minimum touch target.
            "workout-set-toggle flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition-transform",
            "hover:bg-muted/60 active:scale-95 focus-visible:outline-none",
            isToggling && "opacity-60 pointer-events-none"
          )}
        >
          <motion.span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
              isCompleted
                ? "bg-primary"
                : "border-2 border-muted-foreground/40 bg-transparent"
            )}
            initial={false}
            animate={{ scale: isCompleted ? [1, 1.15, 1] : 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <AnimatePresence mode="wait">
              {isCompleted && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Check className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.span>
        </button>
      </div>
    </motion.div>
  );
};

export default ExerciseSetRow;
