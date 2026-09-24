import type { Exercise } from "@/lib/types";

/**
 * Which plan slot an exercise entry is, for positional edits.
 *
 * The name is not enough: one day can hold the same movement twice as two
 * different slots ("Bankdrücken 3×5" and "Bankdrücken 3×12"). A stored `id`
 * is the strongest identity and wins when present. Otherwise the slot is its
 * persisted plan fields - name, sets, reps, rest, weight, description and
 * notes - trimmed, with a missing field and an empty one read alike. Two
 * entries equal in all of them are the same slot content and interchangeable.
 * Deterministic and pure; nothing here is stored.
 */
export const exerciseSlotKey = (exercise: Partial<Exercise> | null | undefined): string => {
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());
  const id = text(exercise?.id);
  if (id) return `id:${id}`;
  return `slot:${JSON.stringify([
    text(exercise?.name),
    text(exercise?.sets),
    text(exercise?.reps),
    text(exercise?.rest),
    text(exercise?.weight),
    text(exercise?.description),
    text(exercise?.notes),
  ])}`;
};

/** Whether `actual` is the slot the user acted on (`expected`). */
export const isExpectedExercise = (
  actual: Partial<Exercise> | null | undefined,
  expected: Partial<Exercise> | null | undefined
): boolean =>
  !!actual && !!expected && typeof actual.name === "string" && exerciseSlotKey(actual) === exerciseSlotKey(expected);
