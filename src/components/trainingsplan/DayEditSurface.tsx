import React from "react";
import { createPortal } from "react-dom";
import { Info, Plus, Sparkles } from "lucide-react";
import ExerciseList from "@/views/ExerciseList";
import { useFocusMode } from "@/contexts/FocusModeContext";
import type { Exercise } from "@/hooks/useExerciseEditor";
import { formatShortDay, type PlanDayRef } from "@/lib/trainingsplanModel";

interface DayEditSurfaceProps {
  day: PlanDayRef;
  title: string;
  exercises: Exercise[];
  isUpdating: boolean;
  onDone: () => void;
  onUpdateExercise: (exerciseIndex: number, exercise: Exercise) => Promise<void>;
  onDeleteExercise: (exerciseIndex: number) => void;
  onAddExercise: () => void;
  onAutoFill: () => void;
}

/**
 * Editing, moved out of the browsing screens (TRAINING-PLAN-V2-01).
 *
 * A compatibility surface, not the final V2 edit mode: it hosts the existing
 * inline editor, swipe-to-delete with undo and the add / autofill dialog with
 * their current persistence, unchanged. Every change is saved as it is made
 * and applies to this one plan day, exactly as before - so there is nothing to
 * discard, and "Fertig" simply returns to the day.
 */
export const DayEditSurface: React.FC<DayEditSurfaceProps> = ({
  day,
  title,
  exercises,
  isUpdating,
  onDone,
  onUpdateExercise,
  onDeleteExercise,
  onAddExercise,
  onAutoFill,
}) => {
  const { isFocusMode } = useFocusMode();
  return (
    <div className="tp-root" style={{ gap: 14 }} data-screen="day-edit">
      <div className="tp-topbar">
        <h1 className="tp-topbar-title tp-ellipsis">{title} bearbeiten</h1>
        <button type="button" className="tp-topbar-action" data-tone="green" onClick={onDone}>
          Fertig
        </button>
      </div>
      <p className="tp-scope">
        <Info aria-hidden="true" />
        <span>
          Änderungen werden sofort gespeichert und gelten nur für diesen Tag ({formatShortDay(day.workoutDay)}).
        </span>
      </p>

      <ExerciseList
        exercises={exercises}
        onUpdateExercise={onUpdateExercise}
        onDeleteExercise={onDeleteExercise}
        isUpdating={isUpdating}
      />

      <div className="tp-footer-spacer" data-size="double" aria-hidden="true" />
      {!isFocusMode && typeof document !== "undefined" && createPortal(
        <div className="tp-footer">
          <div className="tp-footer-inner">
            <button type="button" className="tp-secondary" onClick={onAddExercise}>
              <Plus aria-hidden="true" />
              Übung hinzufügen
            </button>
            <button type="button" className="tp-secondary tp-quiet" onClick={onAutoFill}>
              <Sparkles aria-hidden="true" />
              Auto-ausfüllen
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DayEditSurface;
