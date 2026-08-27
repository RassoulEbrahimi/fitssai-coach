import type { PlanDay, PlanWeek, WorkoutPlanContent } from "../../shared/workoutPlan";

/**
 * Plan fixtures shaped like the ones already stored in production: German day
 * labels, string rep ranges, and rest days that carry an empty exercise list.
 */

const trainingDay = (day: string): PlanDay => ({
  day,
  exercises: [
    { name: "Bankdrücken", sets: 4, reps: "8-10", weight: "60 kg", rest: "90s" },
    { name: "Rudern", sets: 3, reps: "10-12" },
  ],
});

const restDay = (day: string): PlanDay => ({ day, exercises: [] });

const DAY_LABELS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/** Monday, Wednesday and Friday train; the rest are rest days. */
export const makeWeek = (): PlanWeek =>
  DAY_LABELS.map((label, index) =>
    index === 0 || index === 2 || index === 4 ? trainingDay(label) : restDay(label)
  );

export const makeValidPlanContent = (): WorkoutPlanContent => ({
  "Week 1": makeWeek(),
  "Week 2": makeWeek(),
  "Week 3": makeWeek(),
  "Week 4": makeWeek(),
});
