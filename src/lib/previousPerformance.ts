import { readDisplayedDayExercises } from "@/lib/planWeekMirroring";
import {
  isRecordedReps,
  isRecordedWeightKg,
  readActualPerformance,
  USER_RECORDED,
} from "@/lib/setPerformance";
import type { SetPerformanceDraft } from "@/lib/setPerformanceDrafts";
import { formatWeightNumber } from "@/lib/setPerformanceEntry";
import type { WorkoutPlanContent } from "@/lib/types";
import { hasCanonicalMetadata, isWorkoutDayString, type StoredWorkoutLog, type WorkoutDayString } from "@/lib/workoutLog";

/**
 * What the user explicitly recorded the last time they trained an exercise.
 *
 * A reference, never a measurement of today: nothing here writes, completes a
 * set or feeds today's performance. Today's values change only when the user
 * copies a reference into a draft and that draft passes 02A's own commit.
 *
 * Historical logs name no exercise. A log is a position -
 * `planId + weekKey + dayIndex + exerciseIndex` - and that position means an
 * exercise only inside the plan day that produced it. So identity is resolved
 * from the log's own plan, through the same week mirroring the plan-edit
 * guard protects, and matched on exact normalised name plus occurrence within
 * the day. Anything that cannot be resolved that way is skipped, never guessed.
 *
 * Pure: every read arrives through `PreviousPerformanceSource`.
 */

/**
 * The newest dated logs one lookup reads. About 14 workouts' worth of
 * exercise positions and day logs: an exercise last recorded before that
 * shows no reference, which is the cost of never scanning a whole history.
 */
export const PREVIOUS_PERFORMANCE_LOG_LIMIT = 100;

/** Earlier occurrences of one exercise whose sets are opened before giving up. */
export const PREVIOUS_PERFORMANCE_MAX_OCCURRENCES = 6;

/** Performed values from one previous set. At least one is present. */
export interface PreviousSetPerformance {
  reps: number | null;
  weightKg: number | null;
}

/** The one earlier occurrence a reference comes from. Sets keyed by set number. */
export interface PreviousExercisePerformance {
  workoutDay: WorkoutDayString;
  sets: Record<string, PreviousSetPerformance>;
}

export type PreviousPerformanceByIdentity = Record<string, PreviousExercisePerformance>;

export interface StoredDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface PreviousPerformanceSource {
  /** Logs dated strictly before `beforeDay`, newest first, at most `limit`. */
  recentLogs: (beforeDay: WorkoutDayString, limit: number) => Promise<StoredDocument[]>;
  /** A plan's stored content; null when the plan does not exist. Rejects when it cannot be read. */
  planContent: (planId: string) => Promise<unknown>;
  /** Every set document under one exercise-position log. */
  setDocuments: (logId: string) => Promise<StoredDocument[]>;
}

/** The running workout a lookup serves. */
export interface PreviousPerformanceTarget {
  planId: string;
  weekKey: string;
  dayIndex: number;
  workoutDay: WorkoutDayString;
}

/**
 * Case, surrounding and repeated whitespace, and Unicode composition do not
 * make a different exercise. Nothing else is folded: no fuzzy, substring or
 * semantic matching, so `Bankdrücken` never matches `Schrägbankdrücken`.
 */
export const normalizeExerciseName = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const normalized = name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized === "" ? null : normalized;
};

/**
 * One identity per exercise position: its normalised name and which
 * occurrence of that name it is within the day. A day that trains the same
 * exercise twice keeps the two apart. Null for an exercise without a usable name.
 */
export const exerciseIdentityKeys = (exercises: readonly unknown[]): (string | null)[] => {
  const seen = new Map<string, number>();
  return exercises.map((exercise) => {
    const name = normalizeExerciseName((exercise as { name?: unknown } | null | undefined)?.name);
    if (name === null) return null;
    const occurrence = (seen.get(name) ?? 0) + 1;
    seen.set(name, occurrence);
    return JSON.stringify([name, occurrence]);
  });
};

interface HistoricalCandidate {
  logId: string;
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  workoutDay: WorkoutDayString;
}

/**
 * An exercise-position log that can be placed on a calendar by its own stored
 * `workoutDay`. Day logs, logs without a date and malformed positions are not
 * candidates: the date is never reconstructed or taken from `completedAt`.
 */
export const readHistoricalCandidate = ({ id, data }: StoredDocument): HistoricalCandidate | null => {
  if (!hasCanonicalMetadata(data as unknown as StoredWorkoutLog)) return null;
  const { exerciseIndex, dayIndex } = data;
  if (typeof exerciseIndex !== "number" || !Number.isInteger(exerciseIndex) || exerciseIndex < 0) return null;
  if ((dayIndex as number) < 0) return null;
  return {
    logId: id,
    planId: data.planId as string,
    weekKey: data.weekKey as string,
    dayIndex: dayIndex as number,
    exerciseIndex,
    workoutDay: data.workoutDay as WorkoutDayString,
  };
};

/**
 * A full page may end part-way through its oldest day, so that day is left
 * out. Every day that remains is complete, which keeps occurrences within a
 * day and duplicate logs of one position exact.
 */
export const completeDaysOnly = (logs: readonly StoredDocument[], limit: number): StoredDocument[] => {
  if (logs.length < limit) return [...logs];
  const days = logs.map((log) => log.data.workoutDay).filter(isWorkoutDayString);
  if (days.length === 0) return [...logs];
  const oldest = days.reduce((min, day) => (day < min ? day : min));
  return logs.filter((log) => log.data.workoutDay !== oldest);
};

/** The identity of a historical position, read from that log's own plan. */
export const historicalIdentityKey = (
  planContent: unknown,
  position: Pick<HistoricalCandidate, "weekKey" | "dayIndex" | "exerciseIndex">
): string | null => {
  if (!planContent || typeof planContent !== "object" || Array.isArray(planContent)) return null;
  const exercises = readDisplayedDayExercises(planContent as WorkoutPlanContent, position.weekKey, position.dayIndex);
  if (!exercises || position.exerciseIndex >= exercises.length) return null;
  return exerciseIdentityKeys(exercises)[position.exerciseIndex] ?? null;
};

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/**
 * The trusted performed values of one historical position, by set number.
 *
 * Documents are chosen exactly as `useSetTracking` shows them and
 * `setLogWriter` changes them: parents by id, then set documents by id, first
 * document per set number. Only an explicit `user-recorded` marker with a
 * value in today's entry range counts; completion-only, unverified legacy
 * numbers and the prescription never do. Null when nothing is trusted.
 */
export const readPreviousSets = (
  parents: readonly { id: string; docs: readonly StoredDocument[] }[]
): Record<string, PreviousSetPerformance> | null => {
  const claimed = new Set<string>();
  const sets: Record<string, PreviousSetPerformance> = {};
  for (const parent of [...parents].sort(byId)) {
    for (const { data } of [...parent.docs].sort(byId)) {
      // The set reader keys by the stored value as an object key; so does this.
      const key = String(data.setNumber);
      if (claimed.has(key)) continue;
      claimed.add(key);
      if (typeof data.setNumber !== "number" || !/^[1-9]\d*$/.test(key)) continue;
      const actual = readActualPerformance(data);
      if (actual.source !== USER_RECORDED) continue;
      const reps = isRecordedReps(actual.reps) ? actual.reps : null;
      const weightKg = isRecordedWeightKg(actual.weightKg) ? actual.weightKg : null;
      if (reps === null && weightKg === null) continue;
      sets[key] = { reps, weightKg };
    }
  }
  return Object.keys(sets).length > 0 ? sets : null;
};

interface Occurrence {
  position: string;
  days: Set<WorkoutDayString>;
  logIds: string[];
}

/**
 * The most recent earlier occurrence of each wanted exercise identity that
 * carries trusted recorded sets.
 *
 * Strictly before the running workout's day, never the running plan day
 * itself. Occurrences are opened newest first until one has trusted sets, at
 * most `PREVIOUS_PERFORMANCE_MAX_OCCURRENCES` per identity. Sets are never
 * combined across occurrences, and two different trusted occurrences on the
 * same day are ambiguous, so neither is used.
 *
 * A read that fails rejects the whole lookup: an unreadable plan or set list
 * is not the same as an absent one, and skipping it could present an older
 * workout as the last one.
 */
export const findPreviousPerformance = async (
  source: PreviousPerformanceSource,
  target: PreviousPerformanceTarget,
  identityKeys: readonly (string | null)[]
): Promise<PreviousPerformanceByIdentity> => {
  const wanted = new Set(identityKeys.filter((key): key is string => key !== null));
  if (wanted.size === 0 || !isWorkoutDayString(target.workoutDay)) return {};

  const page = await source.recentLogs(target.workoutDay, PREVIOUS_PERFORMANCE_LOG_LIMIT);
  const candidates = completeDaysOnly(page, PREVIOUS_PERFORMANCE_LOG_LIMIT)
    .map(readHistoricalCandidate)
    .filter((candidate): candidate is HistoricalCandidate =>
      candidate !== null &&
      candidate.workoutDay < target.workoutDay &&
      !(candidate.planId === target.planId &&
        candidate.weekKey === target.weekKey &&
        candidate.dayIndex === target.dayIndex));
  if (candidates.length === 0) return {};

  // Each referenced plan once. A log is only ever read against its own plan.
  const planIds = [...new Set(candidates.map((candidate) => candidate.planId))];
  const plans = new Map(await Promise.all(
    planIds.map(async (planId) => [planId, await source.planContent(planId)] as const)
  ));

  const occurrencesByIdentity = new Map<string, Map<string, Occurrence>>();
  for (const candidate of candidates) {
    const identity = historicalIdentityKey(plans.get(candidate.planId), candidate);
    if (identity === null || !wanted.has(identity)) continue;
    const position = JSON.stringify([candidate.planId, candidate.weekKey, candidate.dayIndex, candidate.exerciseIndex]);
    const occurrences = occurrencesByIdentity.get(identity) ?? new Map<string, Occurrence>();
    occurrencesByIdentity.set(identity, occurrences);
    const occurrence = occurrences.get(position) ?? { position, days: new Set(), logIds: [] };
    occurrences.set(position, occurrence);
    occurrence.days.add(candidate.workoutDay);
    occurrence.logIds.push(candidate.logId);
  }

  const result: PreviousPerformanceByIdentity = {};
  await Promise.all([...occurrencesByIdentity].map(async ([identity, occurrences]) => {
    // A position whose logs disagree about their day cannot be dated.
    const ordered = [...occurrences.values()]
      .filter((occurrence) => occurrence.days.size === 1)
      .map((occurrence) => ({ ...occurrence, day: [...occurrence.days][0] }))
      .sort((a, b) => b.day.localeCompare(a.day) || a.position.localeCompare(b.position));

    let inspected = 0;
    for (let index = 0; index < ordered.length;) {
      const day = ordered[index].day;
      const sameDay = [];
      while (index < ordered.length && ordered[index].day === day) sameDay.push(ordered[index++]);
      if (inspected + sameDay.length > PREVIOUS_PERFORMANCE_MAX_OCCURRENCES) return;
      inspected += sameDay.length;

      const trusted = (await Promise.all(sameDay.map(async (occurrence) => readPreviousSets(
        await Promise.all(occurrence.logIds.map(async (logId) => ({ id: logId, docs: await source.setDocuments(logId) })))
      )))).filter((sets): sets is Record<string, PreviousSetPerformance> => sets !== null);

      if (trusted.length > 1) return;
      if (trusted.length === 1) {
        result[identity] = { workoutDay: day, sets: trusted[0] };
        return;
      }
    }
  }));
  return result;
};

const isBlank = (text: string | undefined) => text === undefined || text.trim() === "";

/**
 * Today's draft after explicitly copying a previous set into it.
 *
 * A field is filled only when the previous set has it, nothing is recorded
 * for it today, and its draft is empty. A recorded value, typed text and
 * refused text all stay exactly as they are. Nothing is saved here: the
 * draft reaches storage through the normal commit, or not at all.
 */
export const applyPreviousToDraft = (
  draft: SetPerformanceDraft,
  recorded: { reps: number | null; weightKg: number | null } | undefined,
  previous: PreviousSetPerformance
): SetPerformanceDraft => {
  const next: SetPerformanceDraft = { ...draft };
  if (previous.reps !== null && (recorded?.reps ?? null) === null && isBlank(draft.reps)) {
    next.reps = String(previous.reps);
    next.repsError = undefined;
  }
  if (previous.weightKg !== null && (recorded?.weightKg ?? null) === null && isBlank(draft.weight)) {
    next.weight = formatWeightNumber(previous.weightKg);
    next.weightError = undefined;
  }
  return next;
};

/** `2026-09-08` → `08.09.2026`, without passing through a time zone. */
export const formatWorkoutDayDate = (workoutDay: WorkoutDayString): string => {
  const [year, month, day] = workoutDay.split("-");
  return `${day}.${month}.${year}`;
};
