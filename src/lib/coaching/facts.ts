import type { FitnessGoal } from "./fitnessGoal";

/**
 * The deterministic coaching fact layer.
 *
 * Everything here is a pure function over plain data. No Firestore, no React,
 * no clock: a date-sensitive calculation takes its reference period as an
 * argument. The same inputs always produce the same facts, which is what makes
 * them testable — and what makes it safe for a later AI layer to *explain*
 * them without ever computing one.
 *
 * The guiding rule throughout: an absent measurement is reported as absent. A
 * number is only produced where real data supports it.
 */

/** One day of the plan, as the engine needs to see it. */
export interface PlanDayInput {
  dayIndex: number;
  /** A day with no exercises is a rest day and is never "missed". */
  exerciseCount: number;
}

/** A completion record identified by plan position, not by date. */
export interface CompletionInput {
  weekKey: string;
  dayIndex: number;
  exerciseIndex?: number;
  completed: boolean;
}

/** A day log as read back, with the fields the engine can use. */
export interface DayLogInput {
  weekKey?: string | null;
  dayIndex?: number | null;
  workoutDay?: string | null;
  completed?: boolean | null;
  /** Measured seconds. Absent on every pre-PR47 document. */
  durationSec?: number | null;
}

export interface TrainingDayFacts {
  dayIndex: number;
  isRestDay: boolean;
  /** True only on canonical plan-position evidence. */
  isCompleted: boolean;
}

export type CoverageState = "none" | "partial" | "full";

export interface DurationCoverage {
  state: CoverageState;
  /** Sum of measured seconds only. Never an estimate. */
  measuredDurationSec: number;
  measuredSessionCount: number;
  unmeasuredSessionCount: number;
}

export interface HistoryCoverage {
  /**
   * `complete` — every completion carries plan position.
   * `partial` — some records lack it, so counts are a lower bound.
   * `insufficient` — nothing usable at all.
   */
  state: "complete" | "partial" | "insufficient";
  usableCount: number;
  unusableCount: number;
}

export interface WeeklyAdherenceFacts {
  weekKey: string;
  scheduledDays: number;
  completedDays: number;
  missedDays: number;
  /** 0–100, rounded. Null when nothing is scheduled — 0/0 is not 0%. */
  adherencePercent: number | null;
  days: TrainingDayFacts[];
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/**
 * A day counts as done when a canonical `weekKey` + `dayIndex` record says so.
 *
 * Deliberately not `workoutDay`: day logs written before PR47 can carry a date
 * derived from the plan's creation date rather than its start Monday, so for a
 * plan not created on a Monday that date is simply wrong. Using it here would
 * turn a known-bad value into a confident weekly claim.
 */
export const computeWeeklyAdherence = (
  weekKey: string,
  planDays: readonly PlanDayInput[],
  completions: readonly CompletionInput[]
): WeeklyAdherenceFacts => {
  const completedDayIndexes = new Set(
    completions
      .filter((entry) => entry.completed && entry.weekKey === weekKey)
      .map((entry) => entry.dayIndex)
  );

  const days: TrainingDayFacts[] = planDays.map((day) => {
    const isRestDay = day.exerciseCount === 0;
    return {
      dayIndex: day.dayIndex,
      isRestDay,
      isCompleted: !isRestDay && completedDayIndexes.has(day.dayIndex),
    };
  });

  // Rest days are not training days, so they belong in neither number.
  const trainingDays = days.filter((day) => !day.isRestDay);
  const scheduledDays = trainingDays.length;
  const completedDays = trainingDays.filter((day) => day.isCompleted).length;

  return {
    weekKey,
    scheduledDays,
    completedDays,
    missedDays: scheduledDays - completedDays,
    adherencePercent: scheduledDays === 0 ? null : clampPercent((completedDays / scheduledDays) * 100),
    days,
  };
};

/** Positive, finite, plausible seconds — anything else is "not measured". */
const usableDuration = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 12 * 60 * 60) return null;
  return Math.floor(value);
};

/**
 * How much of a set of sessions actually carries a measured length.
 *
 * `partial` matters: the sum is then a floor across the period, not its total,
 * and the caller must say so rather than presenting it as complete.
 */
export const computeDurationCoverage = (
  logs: readonly DayLogInput[]
): DurationCoverage => {
  let measuredDurationSec = 0;
  let measuredSessionCount = 0;
  let unmeasuredSessionCount = 0;

  logs.forEach((log) => {
    const seconds = usableDuration(log.durationSec);
    if (seconds === null) {
      unmeasuredSessionCount += 1;
      return;
    }
    measuredDurationSec += seconds;
    measuredSessionCount += 1;
  });

  const state: CoverageState =
    measuredSessionCount === 0 ? "none" : unmeasuredSessionCount === 0 ? "full" : "partial";

  return { state, measuredDurationSec, measuredSessionCount, unmeasuredSessionCount };
};

/**
 * Whether the completion records can carry a weekly conclusion at all.
 *
 * A record without `weekKey`/`dayIndex` cannot be placed in the programme, and
 * its date may be the mis-derived one, so it is counted as unusable rather
 * than repaired.
 */
export const computeHistoryCoverage = (
  logs: readonly DayLogInput[]
): HistoryCoverage => {
  let usableCount = 0;
  let unusableCount = 0;

  logs.forEach((log) => {
    const usable =
      typeof log.weekKey === "string" && log.weekKey.length > 0 &&
      typeof log.dayIndex === "number" && Number.isInteger(log.dayIndex);
    if (usable) usableCount += 1;
    else unusableCount += 1;
  });

  if (usableCount === 0) return { state: "insufficient", usableCount, unusableCount };
  return {
    state: unusableCount === 0 ? "complete" : "partial",
    usableCount,
    unusableCount,
  };
};

/* ------------------------------------------------------------------ *
 * Exercise-level facts
 * ------------------------------------------------------------------ */

export interface SetLogInput {
  setNumber: number;
  repsCompleted: number;
  /**
   * Kilograms, when the set was weighted.
   *
   * `null`/absent means no load was recorded — a bodyweight exercise, or a set
   * logged without one. It is never read as 0 kg, which would make a pull-up
   * look like a failed lift.
   */
  weightUsed?: number | null;
}

export interface ExerciseSessionInput {
  /** Stable id where the plan has one; the name is the fallback. */
  exerciseId?: string | null;
  name: string;
  /** Sets the plan asked for, when known. */
  prescribedSets?: number | null;
  sets: readonly SetLogInput[];
}

export interface ExerciseProgressFacts {
  key: string;
  name: string;
  completedSets: number;
  prescribedSets: number | null;
  totalReps: number;
  /** Heaviest recorded load, or null when nothing was weighted. */
  topWeight: number | null;
  /** True when at least one set carried a load. */
  hasWeight: boolean;
}

/**
 * Identity for comparing the same exercise across weeks.
 *
 * Prefers a stable id. Falling back to the name, it lowercases, folds German
 * umlauts and strips non-letters so "Bankdrücken" and "bankdruecken" match.
 * Deliberately exact after that — no fuzzy matching, because a wrong match
 * would produce a confident but false progression claim.
 */
export const exerciseKey = (exercise: Pick<ExerciseSessionInput, "exerciseId" | "name">): string => {
  if (exercise.exerciseId && exercise.exerciseId.trim().length > 0) {
    return `id:${exercise.exerciseId.trim()}`;
  }
  const normalised = exercise.name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return `name:${normalised}`;
};

export const computeExerciseFacts = (
  exercise: ExerciseSessionInput
): ExerciseProgressFacts => {
  const weights = exercise.sets
    .map((set) => set.weightUsed)
    .filter((weight): weight is number => typeof weight === "number" && Number.isFinite(weight) && weight > 0);

  return {
    key: exerciseKey(exercise),
    name: exercise.name,
    completedSets: exercise.sets.length,
    prescribedSets:
      typeof exercise.prescribedSets === "number" && exercise.prescribedSets > 0
        ? exercise.prescribedSets
        : null,
    totalReps: exercise.sets.reduce((sum, set) => sum + (Number.isFinite(set.repsCompleted) ? set.repsCompleted : 0), 0),
    topWeight: weights.length > 0 ? Math.max(...weights) : null,
    hasWeight: weights.length > 0,
  };
};

export type ProgressionKind =
  | "weight-increase"
  | "reps-increase"
  | "sets-increase"
  | "reduced-volume";

export interface ProgressionFact {
  kind: ProgressionKind;
  exerciseName: string;
  previous: number;
  current: number;
}

/**
 * Compare one exercise between two comparable sessions.
 *
 * Returns nothing when the two are not comparable — a different exercise, or a
 * missing side. Weight is only compared when *both* sessions carried a load,
 * so a bodyweight exercise never appears to have "lost" weight, and a set
 * logged without a load never reads as a drop to zero.
 *
 * At most one signal, in priority order, so a single session cannot produce a
 * pile of overlapping claims.
 */
export const compareExercise = (
  previous: ExerciseProgressFacts,
  current: ExerciseProgressFacts
): ProgressionFact | null => {
  if (previous.key !== current.key) return null;

  if (previous.hasWeight && current.hasWeight) {
    const before = previous.topWeight as number;
    const after = current.topWeight as number;
    // Only at comparable volume: more weight for far fewer reps is not a gain.
    if (after > before && current.totalReps >= previous.totalReps * 0.8) {
      return { kind: "weight-increase", exerciseName: current.name, previous: before, current: after };
    }
    if (after === before && current.totalReps > previous.totalReps) {
      return { kind: "reps-increase", exerciseName: current.name, previous: previous.totalReps, current: current.totalReps };
    }
  } else if (!previous.hasWeight && !current.hasWeight && current.totalReps > previous.totalReps) {
    // Bodyweight: reps are the only axis, and that is a real signal.
    return { kind: "reps-increase", exerciseName: current.name, previous: previous.totalReps, current: current.totalReps };
  }

  if (current.completedSets > previous.completedSets) {
    return { kind: "sets-increase", exerciseName: current.name, previous: previous.completedSets, current: current.completedSets };
  }
  if (current.completedSets < previous.completedSets) {
    return { kind: "reduced-volume", exerciseName: current.name, previous: previous.completedSets, current: current.completedSets };
  }

  return null;
};

/** Pair up the same exercises across two weeks and compare each. */
export const compareSessions = (
  previous: readonly ExerciseProgressFacts[],
  current: readonly ExerciseProgressFacts[]
): ProgressionFact[] => {
  const previousByKey = new Map(previous.map((facts) => [facts.key, facts]));
  return current
    .map((facts) => {
      const before = previousByKey.get(facts.key);
      return before ? compareExercise(before, facts) : null;
    })
    .filter((fact): fact is ProgressionFact => fact !== null);
};

/* ------------------------------------------------------------------ *
 * Preference alignment
 * ------------------------------------------------------------------ */

export interface PreferenceAlignment {
  /** Present only when the user stated a preference AND a plan exists. */
  frequency?: { preferred: number; scheduled: number; matches: boolean };
  /**
   * Present only when a preference exists *and* something was measured.
   * `partial` means the average is over the measured subset only.
   */
  sessionLength?: {
    preferredMinutes: number;
    measuredAverageMinutes: number;
    coverage: Exclude<CoverageState, "none">;
    matches: boolean;
  };
}

/** Within this many minutes counts as matching the preference. */
export const SESSION_LENGTH_TOLERANCE_MIN = 10;

export const computePreferenceAlignment = (
  preferences: { daysPerWeek?: number; sessionMinutes?: number },
  scheduledDays: number,
  duration: DurationCoverage
): PreferenceAlignment => {
  const alignment: PreferenceAlignment = {};

  // No preference means no conclusion — never a default to compare against.
  if (typeof preferences.daysPerWeek === "number") {
    alignment.frequency = {
      preferred: preferences.daysPerWeek,
      scheduled: scheduledDays,
      matches: preferences.daysPerWeek === scheduledDays,
    };
  }

  if (typeof preferences.sessionMinutes === "number" && duration.state !== "none") {
    const measuredAverageMinutes = Math.round(
      duration.measuredDurationSec / 60 / duration.measuredSessionCount
    );
    alignment.sessionLength = {
      preferredMinutes: preferences.sessionMinutes,
      measuredAverageMinutes,
      coverage: duration.state,
      matches:
        Math.abs(measuredAverageMinutes - preferences.sessionMinutes) <= SESSION_LENGTH_TOLERANCE_MIN,
    };
  }

  return alignment;
};

/* ------------------------------------------------------------------ *
 * The assembled week
 * ------------------------------------------------------------------ */

export interface WeeklyCoachingFacts {
  adherence: WeeklyAdherenceFacts;
  duration: DurationCoverage;
  history: HistoryCoverage;
  alignment: PreferenceAlignment;
  progression: ProgressionFact[];
  /** Canonical, or undefined. Never inferred. */
  goal?: FitnessGoal;
  /** True once the fixed four-week programme is over. */
  planFinished: boolean;
  /** False when there is nothing truthful to show for the week. */
  hasAnyData: boolean;
}

export interface WeeklyFactsInput {
  weekKey: string;
  planDays: readonly PlanDayInput[];
  completions: readonly CompletionInput[];
  weekLogs: readonly DayLogInput[];
  preferences?: { daysPerWeek?: number; sessionMinutes?: number };
  progression?: readonly ProgressionFact[];
  goal?: FitnessGoal;
  planFinished?: boolean;
}

export const buildWeeklyFacts = (input: WeeklyFactsInput): WeeklyCoachingFacts => {
  const adherence = computeWeeklyAdherence(input.weekKey, input.planDays, input.completions);
  const duration = computeDurationCoverage(input.weekLogs);
  const history = computeHistoryCoverage(input.weekLogs);
  const alignment = computePreferenceAlignment(
    input.preferences ?? {},
    adherence.scheduledDays,
    duration
  );

  return {
    adherence,
    duration,
    history,
    alignment,
    progression: [...(input.progression ?? [])],
    goal: input.goal,
    planFinished: input.planFinished ?? false,
    // A week with a plan but no completions still has something to say; a week
    // with neither does not.
    hasAnyData: adherence.scheduledDays > 0 || adherence.completedDays > 0,
  };
};
