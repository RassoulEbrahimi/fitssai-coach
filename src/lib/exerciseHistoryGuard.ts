import { collection, getDocsFromServer, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";
import type { DayContent, Exercise, WorkoutPlanContent } from "@/lib/types";

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

/** Why an edit was refused. Each reason has its own user-facing wording. */
export type PlanEditRefusal = "history-exists" | "history-unverifiable";

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
 *
 * There is no reorder or move path in the app; the only drag gesture is
 * swipe-to-delete, which routes to `delete`.
 */
export type PlanEditKind = "delete" | "insert" | "append" | "replace";

export interface PlanEdit {
  kind: PlanEditKind;
  /** The index acted on. For `append`, the index the new exercise lands on. */
  exerciseIndex: number;
}

/**
 * The positions whose meaning the edit changes. `to: null` means open-ended -
 * every index from `from` upwards.
 *
 * Removing or inserting at index i shifts everything after it, so position p
 * for p >= i comes to hold what p+1 (or p-1) held. Replacing and appending
 * touch exactly one position: nothing shifts.
 */
export interface AffectedPositions {
  from: number;
  to: number | null;
}

export const affectedPositions = (edit: PlanEdit): AffectedPositions =>
  edit.kind === "delete" || edit.kind === "insert"
    ? { from: edit.exerciseIndex, to: null }
    : { from: edit.exerciseIndex, to: edit.exerciseIndex };

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

/** Read a week the way every plan reader does, tolerating the `week1` key form. */
const readWeek = (
  content: WorkoutPlanContent | undefined,
  weekKey: string
): DayContent[] | undefined => {
  if (!content) return undefined;
  const raw =
    (content as Record<string, unknown>)[weekKey] ??
    (content as Record<string, unknown>)[weekKey.toLowerCase().replace(/\s+/g, "")];
  if (Array.isArray(raw)) return raw as DayContent[];
  if (raw && typeof raw === "object") return Object.values(raw as object) as DayContent[];
  return undefined;
};

/**
 * The week a given week actually displays, following the mirroring in
 * `useWorkoutHelpers.getWeekContentWithFallback`.
 *
 * A week with no content of its own borrows another week's exercises for
 * display, while its own completions and set logs are still written under its
 * own `weekKey`. So editing the source week silently re-points the mirroring
 * week's history too. Returns null when the week displays nothing.
 *
 * This tracks `getWeekContentWithFallback` deliberately: if the two disagreed,
 * the guard would protect a week the user is not actually looking at.
 */
export const displayedSourceWeek = (
  content: WorkoutPlanContent | undefined,
  weekKey: string
): string | null => {
  if (readWeek(content, weekKey)) return weekKey;

  const weekNumber = parseInt(weekKey.replace(/\D/g, ""), 10);
  if (!Number.isFinite(weekNumber)) return null;

  const week1 = readWeek(content, "Week 1");
  const week2 = readWeek(content, "Week 2");

  // Week 1 never mirrors: a plan whose first week is missing shows an empty
  // week rather than borrowing Week 2's exercises.
  if (weekNumber <= 1) return null;
  if ((weekNumber === 3 || weekNumber === 4) && week2) return "Week 2";
  if (weekNumber <= PLAN_TOTAL_WEEKS && week1) return "Week 1";
  return null;
};

/**
 * Every week whose displayed exercises come from `weekKey` - the edited week
 * itself, plus any week mirroring it.
 *
 * Bounded to the plan's four weeks: `resolvePlanDay` reports anything past
 * Week 4 as a finished plan, so no later week can be trained against.
 */
export const weeksDisplaying = (
  content: WorkoutPlanContent | undefined,
  weekKey: string
): string[] => {
  const weeks: string[] = [];
  for (let weekNumber = 1; weekNumber <= PLAN_TOTAL_WEEKS; weekNumber += 1) {
    const candidate = `Week ${weekNumber}`;
    if (displayedSourceWeek(content, candidate) === weekKey) weeks.push(candidate);
  }
  if (!weeks.includes(weekKey)) weeks.push(weekKey);
  return weeks;
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
