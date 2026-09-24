import { PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";
import type { DayContent, WorkoutPlanContent } from "@/lib/types";

/**
 * Which exercises a plan week displays.
 *
 * A week with no content of its own borrows another week's exercises for
 * display, while its own completions and set logs are still written under its
 * own `weekKey`. Two readers have to agree about that borrowing, because both
 * turn a logged position back into an exercise: the plan-edit guard, which
 * protects the positions history already refers to, and the previous-
 * performance lookup, which names the exercise a historical log belongs to.
 * They share this one module so they cannot drift apart.
 *
 * Pure: no Firestore, no React.
 */

/** Read a week the way every plan reader does, tolerating the `week1` key form. */
export const readPlanWeek = (
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
 * Editing the source week silently re-points the mirroring week's history
 * too. Returns null when the week displays nothing.
 *
 * This tracks `getWeekContentWithFallback` deliberately: if the two disagreed,
 * the guard would protect a week the user is not actually looking at.
 */
export const displayedSourceWeek = (
  content: WorkoutPlanContent | undefined,
  weekKey: string
): string | null => {
  if (readPlanWeek(content, weekKey)) return weekKey;

  const weekNumber = parseInt(weekKey.replace(/\D/g, ""), 10);
  if (!Number.isFinite(weekNumber)) return null;

  const week1 = readPlanWeek(content, "Week 1");
  const week2 = readPlanWeek(content, "Week 2");

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

/**
 * The plan day a position displays, through the same mirroring. Undefined when
 * the week displays nothing or has no such day.
 */
export const readDisplayedDay = (
  content: WorkoutPlanContent | undefined,
  weekKey: string,
  dayIndex: number
): DayContent | undefined => {
  const sourceWeek = displayedSourceWeek(content, weekKey);
  if (sourceWeek === null) return undefined;
  const day: unknown = readPlanWeek(content, sourceWeek)?.[dayIndex];
  return day && typeof day === "object" ? (day as DayContent) : undefined;
};

/**
 * The exercises a plan day displays, in plan order - the list its
 * `exerciseIndex` positions refer to. Undefined when the week displays nothing
 * or the day carries no exercise list.
 */
export const readDisplayedDayExercises = (
  content: WorkoutPlanContent | undefined,
  weekKey: string,
  dayIndex: number
): unknown[] | undefined => {
  const exercises = (readDisplayedDay(content, weekKey, dayIndex) as { exercises?: unknown } | undefined)?.exercises;
  return Array.isArray(exercises) ? exercises : undefined;
};
