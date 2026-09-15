import React, { useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatSetTarget } from "@/lib/setPrescription";
import { formatPerformanceValues, formatWeightNumber } from "@/lib/setPerformanceEntry";
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
const FIELD_LABELS: Record<SetPerformanceField, { visible: string; spoken: string }> = {
  reps: { visible: "Wdh.", spoken: "ausgeführte Wiederholungen" },
  weight: { visible: "kg", spoken: "ausgeführtes Gewicht in kg" },
};

const noSubscription = () => () => {};
const noDraft = (): SetPerformanceDraft | undefined => undefined;

/*
  One planned set: its number and prescription, the actual reps and weight the
  user records, and completion. The three are separate controls - the inputs
  never sit inside the completion control, typing never ticks the set, and
  ticking never copies the prescription into the inputs.
*/
export const ExerciseSetRow: React.FC<ExerciseSetRowProps> = ({
  exerciseIndex = 0,
  setNumber,
  targetReps,
  targetWeight,
  isCompleted,
  isToggling,
  onToggle,
  actual,
  performance,
  previous,
}) => {
  // The plan's target, shown as written.
  const target = formatSetTarget(targetReps, targetWeight);
  // Names only what was recorded last time; empty hides the reference entirely.
  const previousText = previous ? formatPerformanceValues(previous) : "";
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
      className={cn(
        "rounded-md border px-3 py-2 transition-colors duration-150",
        isCompleted
          ? "bg-primary/10 border-primary/20"
          : "bg-muted/30 border-transparent"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              id={titleId}
              className={cn("text-xs font-medium", isCompleted ? "text-primary" : "text-muted-foreground")}
            >
              {setNumber}. Satz
            </span>
            {target.visual && (
              <span className="min-w-0 break-words text-sm font-medium text-foreground">
                <span className="text-xs font-normal text-muted-foreground">Vorgabe: </span>
                <span>{target.visual}</span>
              </span>
            )}
          </p>

          {performance && (
            <>
              <div className="mt-1.5 flex items-end gap-2">
                {fields.map((field) => (
                  <div key={field.name} className="flex flex-col">
                    <label htmlFor={field.id} className="text-[11px] font-medium leading-4 text-muted-foreground">
                      <span aria-hidden="true">{FIELD_LABELS[field.name].visible}</span>
                      <span className="sr-only">{`Satz ${setNumber}: ${FIELD_LABELS[field.name].spoken}`}</span>
                    </label>
                    <Input
                      id={field.id}
                      type="text"
                      inputMode={field.name === "reps" ? "numeric" : "decimal"}
                      enterKeyHint="done"
                      autoComplete="off"
                      spellCheck={false}
                      value={field.value}
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
                        "h-11 px-2 text-center tabular-nums",
                        field.name === "reps" ? "w-14" : "w-[4.5rem]",
                        field.error && "border-destructive focus-visible:ring-destructive"
                      )}
                    />
                  </div>
                ))}
              </div>
              {fields.map((field) => field.error && (
                <p key={field.name} id={field.errorId} role="alert" className="mt-1 text-xs text-destructive">
                  {field.error}
                </p>
              ))}
              {/*
                Last time, below today's inputs: a labelled reference, never
                shown inside them. Copying is a separate explicit control that
                fills empty drafts and does nothing else.
              */}
              {previousText && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* Labelled like the prescription: a muted label, readable values. */}
                  <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">
                      <span className="font-medium">Letztes Mal:</span>{" "}
                      <span className="text-foreground">{previousText}</span>
                    </span>
                  </p>
                  {performance.copyPrevious && (
                    <button
                      type="button"
                      aria-label={`Übernehmen für Satz ${setNumber}: Letztes Mal ${previousText}`}
                      onClick={() => performance.copyPrevious?.(exerciseIndex, setNumber)}
                      className={cn(
                        "relative inline-flex h-8 shrink-0 items-center rounded-md border border-input bg-background px-2.5",
                        "text-xs font-medium text-foreground transition-colors hover:bg-muted",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                        // A 44px touch target without making the row taller.
                        "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
                      )}
                    >
                      Übernehmen
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Completion: its own control, with a check shape as well as colour. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isCompleted}
          aria-label={`Satz ${setNumber}: Vorgabe ${target.spoken} — ${isCompleted ? 'abgeschlossen' : 'offen'}`}
          onClick={onToggle}
          className={cn(
            // 44px minimum touch target.
            "flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition-transform",
            "hover:bg-muted/60 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
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
