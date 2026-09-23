import React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Play } from "lucide-react";
import ExerciseGuidanceDialog from "@/components/workout/ExerciseGuidanceDialog";
import { useFocusMode } from "@/contexts/FocusModeContext";
import {
  dayMuscleLine,
  dayToDate,
  formatDaySummaryLine,
  formatPrescription,
  formatShortDay,
  formatWeekdayLong,
  type DayDetailAction,
  type PlanExerciseLike,
  type PlanDayRef,
  type WorkoutDaySummary,
} from "@/lib/trainingsplanModel";

interface DayDetailProps {
  day: PlanDayRef;
  summary: WorkoutDaySummary;
  exercises: readonly PlanExerciseLike[];
  action: DayDetailAction;
  isToday: boolean;
  isCompleted: boolean;
  onBack: () => void;
  /** Opens the editing surface. Omitted where editing does not apply. */
  onEdit?: () => void;
  onStart: () => void;
  onResume: () => void;
  /** The footer action, where focus returns when the running workout closes. */
  primaryRef?: React.Ref<HTMLButtonElement>;
}

/** What the fixed footer says for days that offer no action. */
const footerNote = (action: DayDetailAction, day: PlanDayRef): string | null => {
  switch (action.kind) {
    case "completed": return "Dieses Training ist erledigt.";
    case "future": return `Starten kannst du dieses Training am ${formatShortDay(day.workoutDay)}.`;
    case "past": return "Dieser Trainingstag liegt in der Vergangenheit.";
    default: return null;
  }
};

/**
 * Tagesdetail: one dated workout, browse only. One row per exercise with the
 * prescription right-aligned (the name truncates first); a row opens the
 * existing exercise information. The single action sits in a fixed footer
 * and follows `resolveDayDetailAction` - it never starts a second session,
 * restarts a finished day or moves a future one.
 */
export const DayDetail: React.FC<DayDetailProps> = ({
  day,
  summary,
  exercises,
  action,
  isToday,
  isCompleted,
  onBack,
  onEdit,
  onStart,
  onResume,
  primaryRef,
}) => {
  const eyebrow = [
    formatWeekdayLong(day.workoutDay),
    String(dayToDate(day.workoutDay).getDate()),
    isToday ? "Heute" : null,
    isCompleted ? "Erledigt" : null,
  ].filter(Boolean).join(" · ");
  const muscles = dayMuscleLine(summary);
  const note = footerNote(action, day);
  const hasFooter = action.kind !== "none";
  // The running workout covers the screen; its own controls are the only ones.
  const { isFocusMode } = useFocusMode();

  return (
    <div className="tp-root" style={{ gap: 18 }} data-screen="day-detail">
      <div className="tp-topbar">
        <button type="button" className="tp-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Zurück
        </button>
        {onEdit && (
          <button type="button" className="tp-topbar-action" onClick={onEdit}>
            Bearbeiten
          </button>
        )}
      </div>

      <div className="tp-detail-head">
        <span className="tp-eyebrow">{eyebrow}</span>
        <h1 className="tp-detail-title">{summary.title}</h1>
        <p className="tp-meta">{formatDaySummaryLine(summary)}</p>
        {muscles && <p className="tp-muscles">{muscles}</p>}
      </div>

      {exercises.length > 0 ? (
        <ol className="tp-list" aria-label="Übungen">
          {exercises.map((exercise, index) => (
            <li key={`${exercise.name}-${index}`}>
              <ExerciseGuidanceDialog
                exerciseName={exercise.name}
                trigger={
                  <button type="button" className="tp-exercise" aria-haspopup="dialog">
                    <span className="tp-exercise-num" aria-hidden="true">{index + 1}</span>
                    <span className="tp-exercise-name tp-ellipsis">{exercise.name}</span>
                    <span className="tp-exercise-rx tp-ellipsis">{formatPrescription(exercise)}</span>
                  </button>
                }
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="tp-meta">Für diesen Tag sind keine Übungen geplant.</p>
      )}

      {hasFooter && <div className="tp-footer-spacer" aria-hidden="true" />}
      {hasFooter && !isFocusMode && typeof document !== "undefined" && createPortal(
        <div className="tp-footer" data-testid="day-detail-footer">
          <div className="tp-footer-inner">
            {action.kind === "start" && (
              <button type="button" ref={primaryRef} className="tp-cta" onClick={onStart}>
                <Play fill="currentColor" aria-hidden="true" />
                Training starten
              </button>
            )}
            {action.kind === "resume" && (
              <button type="button" ref={primaryRef} className="tp-cta" onClick={onResume}>
                <Play fill="currentColor" aria-hidden="true" />
                Fortsetzen
              </button>
            )}
            {action.kind === "blocked" && (
              <button type="button" className="tp-secondary tp-fill" disabled>
                Training läuft bereits
              </button>
            )}
            {note && <p className="tp-footer-note">{note}</p>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DayDetail;
