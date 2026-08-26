import {
  compareSessions,
  computeExerciseFacts,
  computeDurationCoverage,
  type ExerciseProgressFacts,
  type ExerciseSessionInput,
  type ProgressionFact,
} from "./facts";

/**
 * Factual summary of one finished session.
 *
 * Pure, like the rest of this layer: it is handed what was logged and returns
 * what that says. It never reads a clock, a store or the network, so it can be
 * called from the finish flow or from a later review screen alike.
 */

export interface SessionSummaryInput {
  exercises: readonly ExerciseSessionInput[];
  /** Measured seconds for this session, when one was recorded. */
  durationSec?: number | null;
  /** The comparable earlier session, when one exists. */
  previousExercises?: readonly ExerciseSessionInput[];
}

export interface SessionSummary {
  exercises: ExerciseProgressFacts[];
  completedSets: number;
  totalReps: number;
  /** Sets the plan asked for, when every exercise declared one. */
  prescribedSets: number | null;
  /** True only when every exercise met its prescribed set count. */
  isFullyCompleted: boolean;
  /** Measured seconds, or null. Never estimated from exercise count. */
  measuredDurationSec: number | null;
  progression: ProgressionFact[];
}

export const summariseSession = (input: SessionSummaryInput): SessionSummary => {
  const exercises = input.exercises.map(computeExerciseFacts);

  const completedSets = exercises.reduce((sum, facts) => sum + facts.completedSets, 0);
  const totalReps = exercises.reduce((sum, facts) => sum + facts.totalReps, 0);

  /*
    Only a total when every exercise declared one — summing a partial set of
    prescriptions would understate the target and make completion look better
    than it was.
  */
  const everyPrescribed = exercises.length > 0 && exercises.every((facts) => facts.prescribedSets !== null);
  const prescribedSets = everyPrescribed
    ? exercises.reduce((sum, facts) => sum + (facts.prescribedSets ?? 0), 0)
    : null;

  const coverage = computeDurationCoverage([{ durationSec: input.durationSec }]);

  return {
    exercises,
    completedSets,
    totalReps,
    prescribedSets,
    isFullyCompleted:
      everyPrescribed && exercises.every((facts) => facts.completedSets >= (facts.prescribedSets ?? 0)),
    measuredDurationSec: coverage.state === "none" ? null : coverage.measuredDurationSec,
    progression: input.previousExercises
      ? compareSessions(input.previousExercises.map(computeExerciseFacts), exercises)
      : [],
  };
};
