import { collection, getDocsFromServer, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { weeksDisplaying } from "@/lib/planWeekMirroring";
import type { Exercise, WorkoutPlanContent } from "@/lib/types";
import { isExpectedExercise } from "@/lib/exerciseSlot";

// Mirroring lives with the other readers that must agree about it.
export { displayedSourceWeek, weeksDisplaying } from "@/lib/planWeekMirroring";
// Plan-slot identity lives with the other pure readers; positional edits check it here.
export { exerciseSlotKey, isExpectedExercise } from "@/lib/exerciseSlot";

/**
 * Guards workout-plan edits that would change what an already-logged exercise
 * position means.
 *
 * Historical training data is keyed by position, not by exercise:
 * `users/{uid}/workout_logs` documents carry `{planId, weekKey, dayIndex,
 * exerciseIndex}`, and `workout_set_logs` hang off those. Nothing in a log
 * names the exercise it belongs to. So "8 reps at 100 kg" only means "Row"
 * because Row happened to sit at that index when the set was written.
 *
 * Deleting an earlier exercise, inserting one, or renaming the exercise at a
 * position therefore re-points existing history at a different movement, with
 * no warning and no way to tell afterwards. This module refuses those edits
 * while such history exists.
 *
 * Every history read here goes to the server, never the cache. `getDocs` is
 * not usable for this question: once the SDK's own connection has failed it
 * enters `OnlineState.Offline` and resolves reads out of the local cache
 * instead of rejecting - and `getFirestore()` is used without persistence, so
 * that cache is empty on every page load. A guard built on `getDocs` would
 * therefore answer "no history" for a user whose device still reports
 * `navigator.onLine === true` but whose SDK cannot reach Firestore: a captive
 * portal, a dropped VPN, a blocked host. The edit would go through, the plan
 * write would be buffered, and reconnecting would commit exactly the drift
 * this module exists to prevent. `getDocsFromServer` rejects in that state,
 * which is the answer the guard needs.
 *
 * What it deliberately does NOT do, because v1.1 is a release-safe fix: no
 * stable exercise ids, no migration, no renaming or deleting of historical
 * documents, and no remapping. History is read for existence only, and every
 * existing reader keeps interpreting it exactly as before. This stops new
 * drift; it does not rewrite the past.
 *
 * One residual remains and is accepted for v1.1: the check and the plan write
 * are not atomic, so a set logged by another tab in the gap between them is
 * still re-pointed. Closing that needs stable exercise ids; the window is one
 * round trip and both surfaces must be open at once, so it stays out of scope.
 */

/**
 * The one lane every edit of a plan's exercise arrays runs in. Each editor
 * reads the plan, rebuilds one day and writes it back, and addresses
 * exercises by position; run side by side, a later edit could read the plan
 * before an earlier one lands and address the wrong exercise, or overwrite it.
 * In one lane each edit reads the result of the one before.
 */
export const planEditLane = (planId: string): string => `plan-edit:${planId}`;

/** Why an edit was refused. Each reason has its own user-facing wording. */
export type PlanEditRefusal = "history-exists" | "history-unverifiable" | "stale-target";

const REFUSAL_COPY: Record<PlanEditRefusal, { title: string; message: string }> = {
  "history-exists": {
    title: "Änderung nicht möglich",
    message:
      "Für diese Position ist bereits Trainingsverlauf gespeichert. " +
      "Diese Änderung würde die gespeicherten Sätze einer anderen Übung zuordnen " +
      "und deinen bisherigen Trainingsverlauf verfälschen.",
  },
  // Not "you are offline": the common case is a device that still reports a
  // connection while the app cannot reach the server. The message says what is
  // true in both - the history could not be checked, so the edit waits.
  "history-unverifiable": {
    title: "Änderung nicht möglich",
    message:
      "Dein gespeicherter Trainingsverlauf lässt sich gerade nicht abrufen. " +
      "Diese Änderung ist erst möglich, wenn geprüft werden kann, ob für diese Übung " +
      "bereits Sätze aufgezeichnet sind. Bitte versuche es erneut, sobald die Verbindung steht.",
  },
  // The list the user acted on is not the list on record (an earlier edit was
  // refused or failed, or another device changed it). Nothing was written.
  "stale-target": {
    title: "Änderung nicht möglich",
    message:
      "Die Übungsliste hat sich inzwischen geändert. Es wurde nichts gespeichert. " +
      "Bitte prüfe die aktuelle Liste und versuche es erneut.",
  },
};

/**
 * Refuse a positional edit whose target is no longer the exercise the user
 * acted on.
 *
 * Edits address exercises by index, and the index a user saw can stop naming
 * that exercise before the edit runs: an earlier edit in the plan's lane may
 * have been refused or failed after the screen already showed its result, or
 * another device may have changed the day. Acting on the index anyway would
 * delete, replace or move a different exercise. Call it on the plan content
 * the edit is about to write, immediately before the write; a mismatch
 * writes nothing and is never redirected to another exercise.
 *
 * Identity is the slot (`exerciseSlotKey`), not the name, so two entries of
 * the same movement with different prescriptions are never confused. Only
 * entries identical in every persisted field are interchangeable. The history
 * guard runs as before either way; this check only adds a refusal.
 */
export const assertExpectedExercise = (
  exercises: readonly Exercise[] | undefined,
  exerciseIndex: number,
  expected: Partial<Exercise>
): void => {
  const actual = Array.isArray(exercises) ? exercises[exerciseIndex] : undefined;
  if (!isExpectedExercise(actual, expected)) throw new PlanEditBlockedError("stale-target");
};

/** A position that already carries history, for diagnostics and telemetry. */
export interface LoggedPosition {
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
}

/**
 * A refused plan edit. Carries its own user-facing title and message so the
 * toast says what actually happened instead of a generic failure.
 *
 * `positions` is diagnostic only and never shown to a user — an exercise index
 * means nothing to someone reading a toast.
 */
export class PlanEditBlockedError extends Error {
  readonly reason: PlanEditRefusal;
  readonly title: string;
  readonly positions: readonly LoggedPosition[];

  constructor(reason: PlanEditRefusal, positions: readonly LoggedPosition[] = []) {
    super(REFUSAL_COPY[reason].message);
    this.name = "PlanEditBlockedError";
    this.reason = reason;
    this.title = REFUSAL_COPY[reason].title;
    this.positions = positions;
  }
}

/**
 * The edits this repository can actually perform on a day's exercise array.
 *
 * - `delete`  - `filter(i !== index)` in `useDeleteExercise`
 * - `insert`  - `splice(index, 0, exercise)` in `useRestoreExercise`
 * - `append`  - `push(exercise)` in `useAddExercise` and `AddWorkoutModal`
 * - `replace` - a name change through `useExerciseEditor`
 * - `move`    - one exercise moved from `exerciseIndex` to `toIndex` in
 *               `useReorderExercise` (the Edit Mode's drag handle)
 */
export type PlanEditKind = "delete" | "insert" | "append" | "replace" | "move";

export interface PlanEdit {
  kind: PlanEditKind;
  /** The index acted on. For `append`, the index the new exercise lands on; for `move`, where it comes from. */
  exerciseIndex: number;
  /** `move` only: where the exercise lands. */
  toIndex?: number;
}

/**
 * The positions whose meaning the edit changes. `to: null` means open-ended -
 * every index from `from` upwards.
 *
 * Removing or inserting at index i shifts everything after it, so position p
 * for p >= i comes to hold what p+1 (or p-1) held. Replacing and appending
 * touch exactly one position: nothing shifts. Moving from i to j gives every
 * position between them, both ends included, a different exercise; nothing
 * outside that range changes.
 */
export interface AffectedPositions {
  from: number;
  to: number | null;
}

export const affectedPositions = (edit: PlanEdit): AffectedPositions => {
  if (edit.kind === "delete" || edit.kind === "insert") return { from: edit.exerciseIndex, to: null };
  if (edit.kind === "move") {
    const to = edit.toIndex ?? edit.exerciseIndex;
    return { from: Math.min(edit.exerciseIndex, to), to: Math.max(edit.exerciseIndex, to) };
  }
  return { from: edit.exerciseIndex, to: edit.exerciseIndex };
};

export const isAffected = (range: AffectedPositions, index: number): boolean =>
  index >= range.from && (range.to === null || index <= range.to);

/**
 * Whether an update replaces the exercise at a position with a different one.
 *
 * Only the name decides. Sets, reps, weight, rest, notes and description are
 * programming metadata: they describe how the same movement is performed and
 * cannot make past history refer to something else. Surrounding whitespace is
 * ignored for the same reason - "  Deadlift  " and "Deadlift" are one exercise.
 */
export const changesExerciseIdentity = (
  before: Exercise | undefined,
  after: Exercise | undefined
): boolean => {
  const nameOf = (exercise: Exercise | undefined) =>
    typeof exercise?.name === "string" ? exercise.name.trim() : "";
  return nameOf(before) !== nameOf(after);
};

const isPositiveNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Whether a `workout_logs` document is evidence that this position was trained.
 *
 * `completed === true` is not the test. A set logged against an exercise the
 * user never ticked off creates a parent document with `completed: false`, and
 * that set is history all the same. Conversely a position that was ticked and
 * then un-ticked leaves a document with nothing recorded on it at all - no
 * completion, no duration, no sets - and nothing there can be misread, so it
 * does not block.
 */
const hasRecordedActivity = async (
  uid: string,
  logId: string,
  data: Record<string, unknown>
): Promise<boolean> => {
  if (data.completed === true) return true;
  if (data.completedAt !== undefined && data.completedAt !== null) return true;
  if (isPositiveNumber(data.durationMinutes)) return true;
  if (isPositiveNumber(data.caloriesBurned)) return true;
  if (isPositiveNumber(data.durationSec)) return true;

  // Set logs live in a subcollection, so their existence cannot be answered by
  // the parent query. One bounded read per candidate parent, and only for
  // parents that carry no evidence of their own. From the server: an empty
  // cached answer here would read as "this position was never trained", which
  // is the same false negative the parent query has to avoid.
  const setsRef = collection(db, "users", uid, "workout_logs", logId, "workout_set_logs");
  const sets = await getDocsFromServer(query(setsRef, limit(1)));
  return !sets.empty;
};

export interface PlanEditGuardParams {
  uid: string;
  planId: string;
  /** Plan content as just read for the edit - the mirroring source of truth. */
  content: WorkoutPlanContent | undefined;
  weekKey: string;
  dayIndex: number;
  edit: PlanEdit;
}

/**
 * The logged positions an edit would re-interpret. Empty means the edit is safe.
 *
 * One query per displayed week, filtered to the day being edited - the same
 * shape `useSetTracking` already runs, so no new composite index is needed. A
 * day holds a handful of exercises, so this reads a handful of documents rather
 * than the user's whole history.
 *
 * Rejects rather than returning an incomplete answer when the server cannot be
 * reached. Callers must treat that as "unverifiable", never as "no history".
 */
export const findLoggedPositions = async ({
  uid,
  planId,
  content,
  weekKey,
  dayIndex,
  edit,
}: PlanEditGuardParams): Promise<LoggedPosition[]> => {
  const range = affectedPositions(edit);
  const logsRef = collection(db, "users", uid, "workout_logs");
  const found: LoggedPosition[] = [];

  for (const week of weeksDisplaying(content, weekKey)) {
    const snap = await getDocsFromServer(
      query(
        logsRef,
        where("planId", "==", planId),
        where("weekKey", "==", week),
        where("dayIndex", "==", dayIndex)
      )
    );
    for (const logDoc of snap.docs) {
      const data = logDoc.data() as Record<string, unknown>;
      const exerciseIndex = data.exerciseIndex;
      if (typeof exerciseIndex !== "number" || !isAffected(range, exerciseIndex)) continue;
      if (await hasRecordedActivity(uid, logDoc.id, data)) {
        found.push({ weekKey: week, dayIndex, exerciseIndex });
      }
    }
  }

  return found;
};

/**
 * Refuse the edit if it would change what already-logged positions mean.
 *
 * Call this immediately before the write, after the plan has been read: the
 * check and the write cannot be made atomic without stable exercise ids, so
 * the smallest available protection is to leave as little as possible between
 * them.
 *
 * There are two refusals, and they are not the same thing. "history exists" is
 * an answer: the server was asked and said yes. "history unverifiable" is the
 * absence of an answer, and it refuses too - a question that could not be put
 * to the server must never be read as a no. `navigator.onLine === false` is
 * only the cheapest of those cases; the load-bearing one is a read that
 * reaches the SDK and fails there, which is why every failure below lands on
 * the same refusal instead of escaping as a network error. Escaping is what
 * would be dangerous: `useSupabaseAction` would retry it four times over seven
 * seconds and then report the caller's generic "could not save", which tells
 * the user nothing about why and invites them to try again into the same hole.
 */
export const assertPlanEditPreservesHistory = async (
  params: PlanEditGuardParams
): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new PlanEditBlockedError("history-unverifiable");
  }

  let positions: LoggedPosition[];
  try {
    positions = await findLoggedPositions(params);
  } catch (error) {
    // A refusal that already carries its own reason keeps it: relabelling a
    // known "history exists" as "could not check" would understate it.
    if (error instanceof PlanEditBlockedError) throw error;
    // Everything else means the same thing here: nobody can say whether this
    // position was trained. Permission, unavailability and a malformed query
    // are indistinguishable to the user and identical in consequence, so they
    // share one refusal rather than leaking a raw error.
    throw new PlanEditBlockedError("history-unverifiable");
  }

  if (positions.length > 0) {
    throw new PlanEditBlockedError("history-exists", positions);
  }
};
