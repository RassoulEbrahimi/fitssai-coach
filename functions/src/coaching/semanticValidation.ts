import {
  DAYS_PER_WEEK,
  PLAN_WEEK_KEYS,
  isRestDay,
  type WorkoutPlanContent,
} from "../../../shared/workoutPlan";
import type { EquipmentType, PlanGenerationInput } from "./planGenerationInput";

/**
 * Checks the shape schema cannot make.
 *
 * Zod proves the plan is a plan. It does not prove the plan is the plan this
 * user asked for: four structurally perfect weeks of six training days, or a
 * barbell programme for somebody who owns a resistance band, would pass it
 * without complaint.
 *
 * Deliberately conservative. This is not an exercise-physiology engine, and a
 * check that guesses is worse than no check — it would reject good plans and
 * burn the one repair attempt doing it.
 */

export interface SemanticIssue {
  path: string;
  message: string;
}

/**
 * How many exercises a session may contain before the plan is implausible for
 * the requested duration.
 *
 * Duration per exercise is genuinely unknown — it depends on sets, rest and
 * the person — so this does not claim to compute session length. It is a broad
 * upper bound: roughly one exercise per five minutes cannot be right, and a
 * floor of three keeps short sessions legal.
 */
export const maxExercisesForSession = (sessionMinutes: number): number =>
  Math.max(3, Math.ceil(sessionMinutes / 5));

/** Equipment implied by a keyword in a German exercise name. */
const EQUIPMENT_KEYWORDS: ReadonlyArray<{ pattern: RegExp; equipment: EquipmentType }> = [
  /*
    German inflects with umlauts, so a keyword written in the singular misses
    the plural the model will often use: "Klimmzüge" is not "Klimmzug", and
    "Widerstandsbänder" is not "Widerstandsband". Every stem below accepts both
    vowels — the first version of this list did not, and a pull-up programme
    for somebody with no bar went through unnoticed.
  */
  { pattern: /langhantel|bankdr(ü|u)cken|kreuzheben/i, equipment: "barbell" },
  { pattern: /kurzhantel|dumbbell/i, equipment: "dumbbells" },
  { pattern: /kettlebell/i, equipment: "kettlebell" },
  { pattern: /kabelz(ü|u)g|cable/i, equipment: "cable_machine" },
  { pattern: /klimmz(ü|u)g|pull-?up/i, equipment: "pullup_bar" },
  { pattern: /widerstandsb(ä|a)nd|resistance ?band|theraband/i, equipment: "resistance_bands" },
  { pattern: /maschine|machine|beinpresse|latz(ü|u)g/i, equipment: "machines" },
];

/**
 * Equipment a name clearly requires, or null when it implies nothing.
 *
 * Only unambiguous keywords are listed. Anything unrecognised is treated as
 * requiring nothing, because guessing that "Ausfallschritte" needs a barbell
 * would reject a perfectly good bodyweight plan.
 */
export const impliedEquipment = (exerciseName: string): EquipmentType | null =>
  EQUIPMENT_KEYWORDS.find(({ pattern }) => pattern.test(exerciseName))?.equipment ?? null;

const allowsEverything = (equipment: readonly EquipmentType[]): boolean =>
  equipment.includes("full_gym");

export const validatePlanSemantics = (
  content: WorkoutPlanContent,
  input: PlanGenerationInput
): SemanticIssue[] => {
  const issues: SemanticIssue[] = [];
  const exerciseCap = maxExercisesForSession(input.sessionMinutes);
  const equipmentIsOpen = allowsEverything(input.equipment);

  for (const weekKey of PLAN_WEEK_KEYS) {
    const week = content[weekKey];

    if (week.length !== DAYS_PER_WEEK) {
      issues.push({
        path: weekKey,
        message: `Woche muss genau ${DAYS_PER_WEEK} Tage haben, hat ${week.length}.`,
      });
      continue;
    }

    const trainingDays = week.filter((day) => !isRestDay(day));

    if (trainingDays.length !== input.daysPerWeek) {
      issues.push({
        path: weekKey,
        message: `Woche muss genau ${input.daysPerWeek} Trainingstage haben, hat ${trainingDays.length}.`,
      });
    }

    const dayLabels = new Set(week.map((day) => day.day.trim().toLowerCase()));
    if (dayLabels.size !== DAYS_PER_WEEK) {
      // Repeated labels mean the array was duplicated rather than filled.
      issues.push({ path: weekKey, message: "Wochentage sind nicht eindeutig." });
    }

    week.forEach((day, dayIndex) => {
      if (day.exercises.length > exerciseCap) {
        issues.push({
          path: `${weekKey}.${dayIndex}`,
          message: `Höchstens ${exerciseCap} Übungen pro Einheit bei ${input.sessionMinutes} Minuten, hat ${day.exercises.length}.`,
        });
      }

      day.exercises.forEach((exercise, exerciseIndex) => {
        const path = `${weekKey}.${dayIndex}.exercises.${exerciseIndex}`;

        if (exercise.name.trim() === "") {
          issues.push({ path, message: "Übungsname fehlt." });
        }

        if (!equipmentIsOpen) {
          const required = impliedEquipment(exercise.name);
          if (required && !input.equipment.includes(required)) {
            issues.push({
              path,
              message: `"${exercise.name}" benötigt ${required}, das nicht verfügbar ist.`,
            });
          }
        }
      });
    });
  }

  return issues;
};
