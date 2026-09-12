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

/** A set document as stored, old or new. */
export interface StoredSetPerformance {
  performanceSource?: unknown;
  repsCompleted?: unknown;
  weightUsed?: unknown;
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
