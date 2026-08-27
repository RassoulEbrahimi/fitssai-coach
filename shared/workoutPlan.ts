import { z } from "zod";

/**
 * The FitssAI workout-plan contract, shared verbatim by the client and the
 * Firebase Functions backend.
 *
 * There is exactly one definition of this shape. A future coaching provider
 * returns raw, untrusted output; this schema is the gate it must pass before
 * anything is persisted, and the same gate the client can use to check a plan
 * it is about to render. Two copies would drift, and the copy that drifted
 * would be the one that let a malformed plan through.
 *
 * Nothing here talks to Firestore, React or a network. It is data shape only.
 */

/** A programme is four weeks. It never wraps and never grows a Week 5. */
export const PLAN_TOTAL_WEEKS = 4;

export const PLAN_WEEK_KEYS = ["Week 1", "Week 2", "Week 3", "Week 4"] as const;

export type PlanWeekKey = (typeof PLAN_WEEK_KEYS)[number];

/** Seven days per week, index 0 = Monday .. 6 = Sunday. */
export const DAYS_PER_WEEK = 7;

/**
 * A single exercise.
 *
 * `reps` is a string because real plans say "8-12" and "bis zum Versagen" as
 * often as they say "10". `sets` is a genuine count, so it is a positive
 * integer — 0 sets is not an exercise, and 2.5 sets is not a number a plan can
 * mean.
 *
 * Unknown keys pass through: stored plans carry per-session fields such as
 * `completed` and `notes`, and rejecting a plan because it remembers more than
 * this schema names would break plans that are perfectly valid.
 */
export const exerciseSchema = z
  .object({
    name: z.string().trim().min(1, "Exercise name is required"),
    sets: z
      .number({ invalid_type_error: "sets must be a number" })
      .int("sets must be a whole number")
      .positive("sets must be greater than zero"),
    reps: z.string().trim().min(1, "reps is required"),
    weight: z.string().optional(),
    rest: z.string().optional(),
    description: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();

export type PlanExercise = z.infer<typeof exerciseSchema>;

/**
 * One day.
 *
 * A rest day is a day with no exercises — an empty array, not a missing key
 * and not a placeholder exercise called "Rest". Callers distinguish the two by
 * `exercises.length`, so an absent array would silently read as a rest day.
 */
export const planDaySchema = z
  .object({
    day: z.string().trim().min(1, "day label is required"),
    exercises: z.array(exerciseSchema),
  })
  .passthrough();

export type PlanDay = z.infer<typeof planDaySchema>;

/** Exactly seven days, in order, Monday first. */
export const planWeekSchema = z
  .array(planDaySchema)
  .length(DAYS_PER_WEEK, `a week must have exactly ${DAYS_PER_WEEK} days`);

export type PlanWeek = z.infer<typeof planWeekSchema>;

/**
 * The four weeks, and only those four.
 *
 * Strict on purpose: an extra key such as "Week 5" or "week1" is an error, not
 * something to quietly drop. A generated plan that invented a fifth week has
 * misunderstood the programme, and the honest response is to reject it rather
 * than persist four fifths of it.
 */
export const workoutPlanContentSchema = z
  .object({
    "Week 1": planWeekSchema,
    "Week 2": planWeekSchema,
    "Week 3": planWeekSchema,
    "Week 4": planWeekSchema,
  })
  .strict();

export type WorkoutPlanContent = z.infer<typeof workoutPlanContentSchema>;

export interface PlanValidationIssue {
  /** Dotted path into the plan, e.g. `Week 2.3.exercises.0.sets`. */
  path: string;
  message: string;
}

export type PlanValidationResult =
  | { ok: true; content: WorkoutPlanContent }
  | { ok: false; issues: PlanValidationIssue[] };

/**
 * Validate untrusted plan content.
 *
 * Returns issues rather than throwing, because the caller — today a human,
 * later the code that decides whether a generated plan may be stored — needs
 * to say what was wrong with it.
 */
export const validateWorkoutPlanContent = (input: unknown): PlanValidationResult => {
  const parsed = workoutPlanContentSchema.safeParse(input);
  if (parsed.success) return { ok: true, content: parsed.data };

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
};

/** True when a day carries no exercises at all. */
export const isRestDay = (day: PlanDay): boolean => day.exercises.length === 0;
