import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowLeftRight, Info, Menu, Plus, Sparkles, X } from "lucide-react";
import { ExercisePickerSheet, type PickerMode } from "./ExercisePickerSheet";
import { AutoFillSheet } from "./AutoFillSheet";
import { logEvent } from "@/lib/telemetryClient";
import { formatPrescription, formatShortDay, type PlanDayRef } from "@/lib/trainingsplanModel";
import { exerciseRowKeys, findMove, moveItem } from "@/lib/trainingsplanEdit";
import type { Exercise } from "@/lib/types";

interface DayEditSurfaceProps {
  day: PlanDayRef;
  title: string;
  exercises: readonly Exercise[];
  /** A running workout executes this day: its structure cannot change now. */
  lockedBySession: boolean;
  onCancel: () => void;
  onDone: () => void;
  /** Resolves once the move has settled, saved or refused. */
  onMove: (fromIndex: number, toIndex: number, exerciseName: string) => void | Promise<unknown>;
  /** `current` is the exercise the user saw at that place. */
  onReplace: (exerciseIndex: number, name: string, current: Exercise) => void;
  onRemove: (exerciseIndex: number, exercise: Exercise) => void;
  onAdd: (exercise: Exercise) => void;
}

interface EditRowProps {
  rowKey: string;
  exercise: Exercise;
  /** The row's place on screen - what every action addresses. */
  index: number;
  count: number;
  locked: boolean;
  hintId: string;
  dragging: boolean;
  onDragStart: (rowKey: string) => void;
  onDragEnd: (rowKey: string) => void;
  onKeyMove: (from: number, to: number) => void;
  onSwap: (index: number) => void;
  onRemove: (index: number) => void;
}

/**
 * One compact row: drag handle, name with its prescription for orientation,
 * replace and remove. The handle alone starts a drag, so the list still
 * scrolls under a finger anywhere else; it also moves the row with the arrow
 * keys.
 */
const EditRow: React.FC<EditRowProps> = ({
  rowKey,
  exercise,
  index,
  count,
  locked,
  hintId,
  dragging,
  onDragStart,
  onDragEnd,
  onKeyMove,
  onSwap,
  onRemove,
}) => {
  const controls = useDragControls();
  const name = exercise.name;
  return (
    <Reorder.Item
      as="li"
      value={rowKey}
      dragListener={false}
      dragControls={controls}
      className="tp-edit-row"
      data-dragging={dragging || undefined}
      data-row-key={rowKey}
      onDragStart={() => onDragStart(rowKey)}
      onDragEnd={() => onDragEnd(rowKey)}
    >
      <button
        type="button"
        className="tp-handle"
        aria-label={`${name} verschieben, Position ${index + 1} von ${count}`}
        aria-describedby={hintId}
        disabled={locked || count < 2}
        onPointerDown={(event) => {
          if (locked || count < 2) return;
          event.preventDefault();
          controls.start(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); onKeyMove(index, index - 1); }
          if (event.key === "ArrowDown" && index < count - 1) { event.preventDefault(); onKeyMove(index, index + 1); }
        }}
      >
        <Menu aria-hidden="true" />
      </button>
      <span className="tp-edit-text">
        <span className="tp-edit-name tp-ellipsis" title={name}>{name}</span>
        <span className="tp-edit-rx tp-ellipsis">{formatPrescription(exercise)}</span>
      </span>
      <button
        type="button"
        className="tp-icon-button"
        aria-label={`${name} ersetzen`}
        aria-haspopup="dialog"
        data-tp-edit="swap"
        disabled={locked}
        onClick={() => onSwap(index)}
      >
        <ArrowLeftRight aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tp-icon-button"
        aria-label={`${name} entfernen`}
        data-tp-edit="remove"
        disabled={locked}
        onClick={() => onRemove(index)}
      >
        <X aria-hidden="true" />
      </button>
    </Reorder.Item>
  );
};

/**
 * Trainingsplan V2 Edit Mode (TRAINING-PLAN-V2-02): the structure of one
 * dated workout day - order, replace, remove, add.
 *
 * Every change is saved as it is made and applies to this plan day only, so
 * there is nothing to discard: "Abbrechen" and "Fertig" both return to the
 * same Day Detail, which already shows the saved state. While a running
 * workout executes this very day, the structure is locked instead of being
 * changed under the live session.
 */
export const DayEditSurface: React.FC<DayEditSurfaceProps> = ({
  day,
  title,
  exercises,
  lockedBySession,
  onCancel,
  onDone,
  onMove,
  onReplace,
  onRemove,
  onAdd,
}) => {
  const keys = useMemo(() => exerciseRowKeys(exercises), [exercises]);
  const byKey = useMemo(() => new Map(keys.map((key, index) => [key, exercises[index]])), [keys, exercises]);
  /*
    The order on screen. It runs ahead of the saved list while moves are on
    their way, and every action addresses a row by its place here: the plan's
    edit lane applies the writes in the same order, so each one lands on the
    list the user saw.
  */
  const [order, setOrderState] = useState<string[]>(keys);
  const orderRef = useRef(order);
  const setOrder = useCallback((next: string[]) => {
    orderRef.current = next;
    setOrderState(next);
  }, []);
  const pendingMoves = useRef(0);
  const [settledMoves, setSettledMoves] = useState(0);
  const dragStartOrder = useRef<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the list shows the result of a keyboard move or a removal. */
  const pendingFocus = useRef<{ kind: "handle"; rowKey: string } | { kind: "remove"; index: number; count: number } | null>(null);
  const hintId = useId();

  /*
    The saved list wins whenever it changes - a removal, an addition, a
    replacement, or a rollback after a refused move, which puts the row back.
    Only a mere reordering is ignored while moves are still on their way or a
    row is in the hand: that is the screen catching up with itself. Once the
    last move settles, the saved order is taken as it is.
  */
  useEffect(() => {
    const local = orderRef.current;
    const sameRows = local.length === keys.length && [...local].sort().join("\n") === [...keys].sort().join("\n");
    if (sameRows && (pendingMoves.current > 0 || dragStartOrder.current)) return;
    setOrder(keys);
  }, [keys, settledMoves, setOrder]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const list = listRef.current;
    if (target.kind === "handle") {
      pendingFocus.current = null;
      const rows = list ? [...list.querySelectorAll<HTMLElement>("[data-row-key]")] : [];
      rows.find((row) => row.dataset.rowKey === target.rowKey)?.querySelector<HTMLElement>(".tp-handle")?.focus();
      return;
    }
    // A removal: wait for the row to leave, then focus the one that took its place.
    if (order.length > target.count - 1) return;
    pendingFocus.current = null;
    const removes = list ? [...list.querySelectorAll<HTMLElement>('[data-tp-edit="remove"]')] : [];
    (removes[Math.min(target.index, removes.length - 1)] ?? addRef.current)?.focus();
  }, [order]);

  /** Saves one move of the row `rowKey` from `from` to `to`. */
  const persistMove = useCallback((from: number, to: number, rowKey: string) => {
    const exercise = byKey.get(rowKey);
    if (!exercise || from === to) return;
    pendingMoves.current += 1;
    void Promise.resolve(onMove(from, to, exercise.name)).finally(() => {
      pendingMoves.current -= 1;
      if (pendingMoves.current === 0) setSettledMoves((count) => count + 1);
    });
    setAnnouncement(`${exercise.name}: Position ${to + 1} von ${orderRef.current.length}.`);
  }, [byKey, onMove]);

  const handleKeyMove = useCallback((from: number, to: number) => {
    const rowKey = orderRef.current[from];
    pendingFocus.current = { kind: "handle", rowKey };
    setOrder(moveItem(orderRef.current, from, to));
    persistMove(from, to, rowKey);
  }, [persistMove, setOrder]);

  const handleDragStart = useCallback((rowKey: string) => {
    dragStartOrder.current = orderRef.current;
    setDragging(rowKey);
  }, []);

  const handleDragEnd = useCallback((rowKey: string) => {
    const before = dragStartOrder.current;
    dragStartOrder.current = null;
    setDragging(null);
    const move = before ? findMove(before, orderRef.current, rowKey) : null;
    if (move) persistMove(move.from, move.to, rowKey);
    else setSettledMoves((count) => count + 1);
  }, [persistMove]);

  const handleSwap = useCallback((index: number) => {
    const exercise = byKey.get(orderRef.current[index]);
    if (exercise) setPicker({ kind: "replace", exerciseIndex: index, exerciseName: exercise.name });
  }, [byKey]);

  const handleRemove = useCallback((index: number) => {
    const exercise = byKey.get(orderRef.current[index]);
    if (!exercise) return;
    pendingFocus.current = { kind: "remove", index, count: orderRef.current.length };
    setAnnouncement(`${exercise.name} entfernt.`);
    onRemove(index, exercise);
  }, [byKey, onRemove]);

  const openAdd = useCallback(() => {
    setAutoFillOpen(false);
    setPicker({ kind: "add" });
    logEvent("add_exercise_dialog_opened", { weekKey: day.weekKey, dayIndex: day.dayIndex, mode: "manual" });
  }, [day.weekKey, day.dayIndex]);

  const openAutoFill = useCallback(() => {
    setAutoFillOpen(true);
    logEvent("ai_autofill_opened", { weekKey: day.weekKey, dayIndex: day.dayIndex });
  }, [day.weekKey, day.dayIndex]);

  const dayNames = useMemo(() => exercises.map((exercise) => exercise.name), [exercises]);

  return (
    <div className="tp-root tp-edit" data-screen="day-edit">
      <div className="tp-edit-bar">
        <button type="button" className="tp-topbar-action tp-edit-cancel" onClick={onCancel}>
          Abbrechen
        </button>
        <h1 className="tp-topbar-title tp-ellipsis">{title} bearbeiten</h1>
        <button type="button" className="tp-topbar-action" data-tone="green" onClick={onDone}>
          Fertig
        </button>
      </div>

      <p className="tp-edit-scope">
        Nur {formatShortDay(day.workoutDay)} · Änderungen werden sofort gespeichert.
      </p>

      {lockedBySession && (
        <p className="tp-scope" role="status">
          <Info aria-hidden="true" />
          <span>Dieses Training läuft gerade. Die Übungen kannst du ändern, sobald es beendet ist.</span>
        </p>
      )}

      <p id={hintId} className="sr-only">Mit den Pfeiltasten nach oben oder unten verschieben.</p>
      {exercises.length > 0 ? (
        <Reorder.Group
          as="ol"
          axis="y"
          ref={listRef}
          values={order}
          onReorder={setOrder}
          className="tp-edit-list"
          aria-label="Übungen"
        >
          {order.map((rowKey, position) => {
            const exercise = byKey.get(rowKey);
            if (!exercise) return null;
            return (
              <EditRow
                key={rowKey}
                rowKey={rowKey}
                exercise={exercise}
                index={position}
                count={order.length}
                locked={lockedBySession}
                hintId={hintId}
                dragging={dragging === rowKey}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onKeyMove={handleKeyMove}
                onSwap={handleSwap}
                onRemove={handleRemove}
              />
            );
          })}
        </Reorder.Group>
      ) : (
        <p className="tp-meta">Für diesen Tag sind keine Übungen geplant.</p>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      <div className="tp-edit-actions">
        <button ref={addRef} type="button" className="tp-secondary tp-edit-add" disabled={lockedBySession} onClick={openAdd}>
          <Plus aria-hidden="true" />
          Übung hinzufügen
        </button>
        <button type="button" className="tp-secondary tp-quiet" onClick={openAutoFill}>
          <Sparkles aria-hidden="true" />
          Auto-ausfüllen
        </button>
      </div>

      <ExercisePickerSheet
        mode={picker}
        dayExerciseNames={dayNames}
        onClose={() => setPicker(null)}
        onReplace={(index, name) => {
          const current = byKey.get(orderRef.current[index]);
          if (!current) return;
          setAnnouncement(`${current.name} durch ${name} ersetzt.`);
          onReplace(index, name, current);
        }}
        onAdd={(exercise) => {
          setAnnouncement(`${exercise.name} hinzugefügt.`);
          onAdd(exercise);
        }}
      />
      <AutoFillSheet
        open={autoFillOpen}
        onClose={() => setAutoFillOpen(false)}
        onAddManually={lockedBySession ? undefined : openAdd}
      />
    </div>
  );
};

export default DayEditSurface;
