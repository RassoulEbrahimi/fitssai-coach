/**
 * Completion versus actual performance for one logged set.
 *
 * Ticking a set says one thing: the user finished it. It does not say how many
 * reps they did or what they lifted — the plan's prescription is what they
 * were asked to do, not a measurement. Before this marker existed, the set
 * checkbox copied the prescription into `repsCompleted`/`weightUsed`, so those
 * fields on older documents look like measurements and are not.
 *
 * Every `workout_set_logs` document is therefore read through
 * `readActualPerformance`, and reps/weight are only ever reported when the
 * document says they were explicitly recorded as performed.
 *
 * Recorded performance is independent of completion: a user can enter reps or
 * weight before ticking a set, after it, or without ever ticking it. So a set
 * document no longer means "completed" just by existing - `readSetCompletion`
 * holds the rule that keeps every older document reading exactly as before.
 *
 * Pure: no Firestore, no React.
 */

/** Where a set document's reps/weight came from. */
export type SetPerformanceSource =
  /** The set was ticked complete. Nothing about reps or load is known. */
  | "completion-only"
  /** Reps and/or load were explicitly entered as what the user performed. */
  | "user-recorded";

export const COMPLETION_ONLY: SetPerformanceSource = "completion-only";
export const USER_RECORDED: SetPerformanceSource = "user-recorded";

/** The fields a new completion-only set document carries besides its identity. */
export const completionOnlySetFields = (): { performanceSource: SetPerformanceSource } => ({
  performanceSource: COMPLETION_ONLY,
});

/** Generous, finite bounds for what a user can record for one set. */
export const MAX_RECORDED_REPS = 999;
export const MAX_RECORDED_WEIGHT_KG = 1000;

/** A whole, non-negative rep count. 0 is a real result, not "not recorded". */
export const isRecordedReps = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_RECORDED_REPS;

/** A positive load in kg with at most two decimals. 0 never stands for "no weight". */
export const isRecordedWeightKg = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_RECORDED_WEIGHT_KG &&
  Math.round(value * 100) / 100 === value;

/** A set document as stored, old or new. */
export interface StoredSetPerformance {
  performanceSource?: unknown;
  repsCompleted?: unknown;
  weightUsed?: unknown;
}

export interface StoredSetLog extends StoredSetPerformance {
  completed?: unknown;
  completedAt?: unknown;
}

export interface ActualSetPerformance {
  /**
   * `unverified` — a document without a known marker. Every set written before
   * the marker existed is one, and their reps/weight were copied from the plan.
   */
  source: SetPerformanceSource | "unverified";
  /** Performed reps, or null when not recorded. Never the prescription. */
  reps: number | null;
  /** Performed load in kg, or null when not recorded. Never 0 for "none". */
  weightKg: number | null;
}

const isKnownSource = (value: unknown): value is SetPerformanceSource =>
  value === COMPLETION_ONLY || value === USER_RECORDED;

/**
 * Whether a stored set counts as completed.
 *
 * Compatibility rule - nothing is migrated or backfilled for it:
 *
 * - A set is open only when it says so explicitly: `completed: false` together
 *   with a known `performanceSource` marker. Only writers that know about
 *   recorded performance produce that pair, and only for one reason: reps or
 *   weight recorded on a set that has not been ticked.
 * - Every other document that exists is completed. Until recorded performance,
 *   a set document existed only while its set was ticked, and no writer ever
 *   put `completed` on one - not the Supabase import, not the Firebase writer
 *   that copied the prescription, not the completion-only marker. Those all
 *   still read as completed, and so does anything unrecognised: reading a
 *   ticked set as open would silently erase training the user did.
 */
export const readSetCompletion = (stored: StoredSetLog): boolean =>
  !(stored.completed === false && isKnownSource(stored.performanceSource));

/**
 * What a stored set actually says about performance.
 *
 * Only an explicit `user-recorded` marker lets reps or weight through. A
 * missing or unknown marker is treated as unverified rather than trusted,
 * because a number on the document is exactly what the old checkbox wrote.
 */
export const readActualPerformance = (stored: StoredSetPerformance): ActualSetPerformance => {
  if (stored.performanceSource !== USER_RECORDED) {
    return {
      source: stored.performanceSource === COMPLETION_ONLY ? COMPLETION_ONLY : "unverified",
      reps: null,
      weightKg: null,
    };
  }
  const reps = stored.repsCompleted;
  const weight = stored.weightUsed;
  return {
    source: USER_RECORDED,
    reps: typeof reps === "number" && Number.isFinite(reps) && reps >= 0 ? reps : null,
    weightKg: typeof weight === "number" && Number.isFinite(weight) && weight > 0 ? weight : null,
  };
};

/**
 * One requested change to one set. Completion and performance never travel in
 * the same change, so neither can imply the other.
 */
export type SetLogChange =
  | { kind: "completion"; completed: boolean }
  /**
   * Performed values as the user entered them. `undefined` leaves a field as
   * stored and `null` clears it - an absent value is not an instruction to
   * erase the other field. Never derived from the prescription.
   */
  | { kind: "performance"; reps?: number | null; weightKg?: number | null };

export class InvalidSetPerformanceError extends Error {
  constructor() {
    super("Recorded set performance is out of range or malformed.");
    this.name = "InvalidSetPerformanceError";
  }
}

/** A performance change that names at least one field, each null or in range. */
export const isValidPerformanceChange = (change: { reps?: unknown; weightKg?: unknown }): boolean =>
  (change.reps !== undefined || change.weightKg !== undefined) &&
  (change.reps === undefined || change.reps === null || isRecordedReps(change.reps)) &&
  (change.weightKg === undefined || change.weightKg === null || isRecordedWeightKg(change.weightKg));

export type SetLogWrite =
  | { type: "unchanged" }
  | { type: "delete" }
  | { type: "write"; data: Record<string, unknown> };

const UNCHANGED: SetLogWrite = { type: "unchanged" };

/**
 * What one change does to one stored set document.
 *
 * The online writer, offline replay and the optimistic view all go through
 * here, so they cannot disagree about the result:
 *
 * - Completing keeps recorded values and copies nothing from the plan.
 * - Un-ticking keeps recorded values; the set stays, open.
 * - Clearing both values leaves a completed set completion-only, and removes
 *   an open set entirely - a document that records nothing has no reason to
 *   exist, and must not keep a marker claiming performance.
 * - A change that changes nothing writes nothing, so an older document is only
 *   rewritten when the user actually changed that set.
 */
export const planSetLogWrite = (
  stored: StoredSetLog | undefined,
  setNumber: number,
  change: SetLogChange,
  now: () => unknown
): SetLogWrite => {
  const wasCompleted = stored !== undefined && readSetCompletion(stored);
  const recorded = stored ? readActualPerformance(stored) : { reps: null, weightKg: null };
  let completed = wasCompleted;
  let reps = recorded.reps;
  let weightKg = recorded.weightKg;

  if (change.kind === "completion") {
    completed = change.completed;
    if (completed === wasCompleted) return UNCHANGED;
  } else {
    if (!isValidPerformanceChange(change)) throw new InvalidSetPerformanceError();
    if (change.reps !== undefined) reps = change.reps;
    if (change.weightKg !== undefined) weightKg = change.weightKg;
    if (reps === recorded.reps && weightKg === recorded.weightKg) return UNCHANGED;
  }

  const hasPerformance = reps !== null || weightKg !== null;
  if (!completed && !hasPerformance) return stored ? { type: "delete" } : UNCHANGED;

  return {
    type: "write",
    data: {
      setNumber,
      completed,
      ...(completed
        ? { completedAt: wasCompleted && stored?.completedAt != null ? stored.completedAt : now() }
        : {}),
      performanceSource: hasPerformance ? USER_RECORDED : COMPLETION_ONLY,
      ...(reps !== null ? { repsCompleted: reps } : {}),
      ...(weightKg !== null ? { weightUsed: weightKg } : {}),
    },
  };
};

/** A set as the UI reads it: completion and trusted performance, side by side. */
export interface SetLogState {
  completed: boolean;
  actual: ActualSetPerformance;
  completedAt?: unknown;
}

export const readSetLogState = (stored: StoredSetLog): SetLogState => ({
  completed: readSetCompletion(stored),
  actual: readActualPerformance(stored),
  completedAt: stored.completedAt,
});

const storedFromState = (state: SetLogState): StoredSetLog => ({
  completed: state.completed,
  performanceSource: state.actual.source !== "unverified"
    ? state.actual.source
    : state.completed ? undefined : COMPLETION_ONLY,
  ...(state.actual.reps !== null ? { repsCompleted: state.actual.reps } : {}),
  ...(state.actual.weightKg !== null ? { weightUsed: state.actual.weightKg } : {}),
  completedAt: state.completedAt,
});

/** `planSetLogWrite` applied to a read state instead of a document. */
export const applySetLogChangeToState = (
  current: SetLogState | undefined,
  setNumber: number,
  change: SetLogChange,
  now: () => unknown
): SetLogState | undefined => {
  const plan = planSetLogWrite(current && storedFromState(current), setNumber, change, now);
  if (plan.type === "unchanged") return current;
  if (plan.type === "delete") return undefined;
  return readSetLogState(plan.data);
};
