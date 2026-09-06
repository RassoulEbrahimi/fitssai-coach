import type { Firestore } from "firebase-admin/firestore";
import {
  computeWeeklyReviewMetrics,
  type ReviewCompletion,
  type ReviewLog,
  type ReviewPlanDay,
  type WeeklyReviewMetrics,
} from "../../../shared/weeklyRecommendation";
import { resolvePlanWeek, type ResolvedPlanWeek } from "../../../shared/planWeek";
import { readCompletedWorkoutDays } from "../../../shared/workoutCompletion";
import { normaliseFitnessGoal } from "./profileInput";
import { EXPERIENCE_LEVELS, type ExperienceLevel, type FitnessGoal } from "./planGenerationInput";

/**
 * Everything the weekly review reads, read by the server.
 *
 * The browser sends no metric and no week: it sends nothing at all. The plan,
 * the logs and the two profile fields are read here under the uid the auth
 * guard resolved from a verified token, so a caller can neither review someone
 * else's week nor claim a completion they never logged.
 *
 * This module only ever reads. Nothing in the weekly review writes to
 * `users/{uid}/workout_plans` — a review that could touch a plan would be a
 * background plan modification, which is exactly what this feature promises
 * not to be.
 */

/*
 * The plan-week arithmetic now lives in `shared/planWeek.ts` so the backend
 * and the client agree on it by construction rather than by review. It is
 * re-exported here because that is where the rest of this feature imports it
 * from, and because a Berlin week boundary is precisely the thing this module
 * must not get wrong twice.
 */
export { berlinDayNumber, mondayIndex } from "../../../shared/planWeek";

export type ResolvedReviewWeek = ResolvedPlanWeek;

/** Which week of the programme a date falls in. See `shared/planWeek.ts`. */
export const resolveReviewWeek = resolvePlanWeek;

/* ------------------------------------------------------------------ *
 * Reading the stored documents
 * ------------------------------------------------------------------ */

/** A stored timestamp, however the SDK or a legacy write left it. */
const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const timestamp = value as { toDate?: () => Date } | null;
  if (typeof timestamp?.toDate === "function") {
    const date = timestamp.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/**
 * The seven days of one plan week, as counts of exercises.
 *
 * Tolerates every stored shape the app has produced: `"Week 1"` and `"week1"`
 * keys, an array of days or an object keyed by index. Anything it cannot read
 * becomes a day with no exercises — a rest day — because a day whose content
 * cannot be parsed is not a training day somebody failed to do.
 */
export const readPlanWeek = (content: unknown, weekKey: string): ReviewPlanDay[] => {
  const record = (content ?? {}) as Record<string, unknown>;
  const raw = record[weekKey] ?? record[weekKey.toLowerCase().replace(/\s+/g, "")];
  const days = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];

  return Array.from({ length: 7 }, (_, dayIndex) => {
    const day = days[dayIndex] as { exercises?: unknown } | undefined;
    const exercises = day?.exercises;
    return { dayIndex, exerciseCount: Array.isArray(exercises) ? exercises.length : 0 };
  });
};

export interface StoredLog {
  weekKey?: unknown;
  dayIndex?: unknown;
  exerciseIndex?: unknown;
  workoutDay?: unknown;
  completed?: unknown;
  durationSec?: unknown;
}

/**
 * Completed days, from the day session records only.
 *
 * `users/{uid}/workout_logs` holds day sessions and exercise positions in one
 * collection, and both carry `weekKey`, `dayIndex` and `completed`. Reading
 * those three fields alone counted a single ticked exercise as a finished
 * training day, so which row may speak for a day is now decided by
 * `shared/workoutCompletion.ts` — the same rule the client applies.
 *
 * A log without `weekKey` + `dayIndex` still cannot be placed in the
 * programme. Its `workoutDay` is deliberately not used as a fallback: a log
 * written before PR47 can carry a date derived from the plan's creation date
 * rather than its start Monday, and reading it here would turn a known-bad
 * value into a confident weekly claim.
 */
export const readCompletions = (logs: readonly StoredLog[]): ReviewCompletion[] =>
  readCompletedWorkoutDays(logs).map((day) => ({ ...day, completed: true }));

/**
 * The reviewed week's logs, in the shape the metric layer reads.
 *
 * Every row of the week is passed through, exercise positions included, and
 * that is deliberate: `computeWeeklyReviewMetrics` groups them by day and
 * takes the longest usable measurement any of a day's documents carries, then
 * counts coverage over the days the week actually completed. Filtering here
 * would take that tolerance away without changing a single count — a row's
 * presence no longer inflates the session count, and only the completions
 * above decide which days are done.
 */
export const readWeekLogs = (logs: readonly StoredLog[], weekKey: string): ReviewLog[] =>
  logs
    .filter((log) => log.weekKey === weekKey)
    .map((log) => ({
      weekKey: weekKey,
      dayIndex: typeof log.dayIndex === "number" ? log.dayIndex : null,
      completed: log.completed === true,
      durationSec: typeof log.durationSec === "number" ? log.durationSec : null,
    }));

export interface CoachingProfileFacts {
  goal?: FitnessGoal;
  experienceLevel?: ExperienceLevel;
}

/**
 * The two profile fields a recommendation may use.
 *
 * Nothing else is read from the document, and an absent value stays absent —
 * a person who never chose a goal does not get one guessed for them, and the
 * review works perfectly well without it.
 */
export const readCoachingProfile = async (
  firestore: Firestore,
  uid: string
): Promise<CoachingProfileFacts> => {
  const snap = await firestore.collection("users").doc(uid).get();
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  const experience = raw.experienceLevel;

  return {
    goal: normaliseFitnessGoal(raw.fitnessGoal),
    experienceLevel:
      typeof experience === "string" && (EXPERIENCE_LEVELS as readonly string[]).includes(experience)
        ? (experience as ExperienceLevel)
        : undefined,
  };
};

export interface WeeklyReviewData {
  metrics: WeeklyReviewMetrics;
  profile: CoachingProfileFacts;
  /** True once the four-week programme is over. */
  planFinished: boolean;
}

/**
 * Read the caller's plan and logs and reduce them to the week's metrics.
 *
 * Two reads and one profile read, all under the caller's own uid, all
 * read-only. A user with no plan gets an honest empty week rather than an
 * error: "nothing is planned yet" is a true thing to say and a useful one.
 */
export const readWeeklyReviewData = async (
  firestore: Firestore,
  uid: string,
  at: Date
): Promise<WeeklyReviewData> => {
  const user = firestore.collection("users").doc(uid);

  const plans = await user
    .collection("workout_plans")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  const planDoc = plans.docs[0];
  const planCreatedAt = planDoc ? toDate(planDoc.get("createdAt")) : null;
  const week = planCreatedAt
    ? resolveReviewWeek(planCreatedAt, at)
    : { weekKey: null, weekNumber: null, previousWeekKey: null, planFinished: false };

  const profile = await readCoachingProfile(firestore, uid);

  if (!planDoc || week.weekKey === null) {
    return {
      metrics: computeWeeklyReviewMetrics({
        weekKey: week.weekKey ?? "",
        weekNumber: week.weekNumber,
        hasPlan: false,
        planDays: [],
        completions: [],
        weekLogs: [],
      }),
      profile,
      planFinished: week.planFinished,
    };
  }

  const logsSnap = await user
    .collection("workout_logs")
    .where("planId", "==", planDoc.id)
    .get();
  const logs = logsSnap.docs.map((doc) => doc.data() as StoredLog);

  const content = planDoc.get("content");

  return {
    metrics: computeWeeklyReviewMetrics({
      weekKey: week.weekKey,
      weekNumber: week.weekNumber,
      hasPlan: true,
      planDays: readPlanWeek(content, week.weekKey),
      completions: readCompletions(logs),
      weekLogs: readWeekLogs(logs, week.weekKey),
      previousWeek: week.previousWeekKey
        ? {
            weekKey: week.previousWeekKey,
            planDays: readPlanWeek(content, week.previousWeekKey),
          }
        : null,
    }),
    profile,
    planFinished: false,
  };
};
