import { formatExerciseMuscleSubtitle } from "@/lib/exerciseMuscleSummary";
import { displayedSourceWeek } from "@/lib/planWeekMirroring";
import { normalizeWeekKey } from "@/lib/workoutPlanUtils";
import type { Exercise, WorkoutPlanContent } from "@/lib/types";

/*
  Trainingsplan V2 Edit Mode (TRAINING-PLAN-V2-02) as data: what a reorder,
  a replacement and an addition write, which catalogue entries count as
  similar, and when a running workout locks a day. Pure: no Firestore, no
  React. Every edit here applies to one plan day's exercise array.
*/

/**
 * The list with the item at `from` moved to `to`, everything else in order.
 * Returns a new array; the input is never mutated. Throws on an index outside
 * the list, so a stale drag can never duplicate or drop an exercise.
 */
export const moveItem = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < list.length;
  if (!inRange(from) || !inRange(to)) throw new RangeError(`Cannot move ${from} to ${to} in a list of ${list.length}`);
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * Stable row keys for a day's exercises: the name plus its occurrence, so a
 * row keeps its key while it moves and two rows never share one.
 */
export const exerciseRowKeys = (exercises: readonly { name: string }[]): string[] => {
  const seen = new Map<string, number>();
  return exercises.map((exercise) => {
    const name = typeof exercise?.name === "string" ? exercise.name : "";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return `${name}#${count}`;
  });
};

/**
 * The single move that turns `before` into `after`, when one drag produced it:
 * the dragged key's old and new index. Null when nothing moved.
 */
export const findMove = (before: readonly string[], after: readonly string[], dragged: string): { from: number; to: number } | null => {
  const from = before.indexOf(dragged);
  const to = after.indexOf(dragged);
  if (from < 0 || to < 0 || from === to || before.length !== after.length) return null;
  return { from, to };
};

/**
 * Fields that describe one particular movement rather than the slot it fills.
 * A carried-over load or note would be advice about the exercise that left.
 */
const MOVEMENT_SPECIFIC_FIELDS = ["weight", "description", "notes"] as const;

/**
 * The exercise that replaces `current` at its position.
 *
 * Sets, reps and rest are the day's prescription for that slot, so they stay.
 * Weight, description and notes belong to the movement being replaced and
 * would mislead on another one: they are cleared - to an empty string, the
 * value the existing add flow writes, never to a guess. Everything else the
 * plan stored on the slot is kept untouched.
 */
export const buildReplacement = (current: Exercise, name: string): Exercise => {
  const next: Exercise = { ...current, name: name.trim() };
  for (const field of MOVEMENT_SPECIFIC_FIELDS) {
    if (field in next) next[field] = "";
  }
  return next;
};

/** The prescription a new exercise starts from: the existing add form's defaults. */
export const DEFAULT_NEW_PRESCRIPTION = { sets: "3", reps: "10", rest: "90s" } as const;

export interface PrescriptionDraft {
  sets: string;
  reps: string;
  rest: string;
}

/** Why a draft cannot be saved yet, or null when it can. */
export const validatePrescription = (draft: PrescriptionDraft): string | null => {
  const sets = Number(draft.sets.trim());
  if (!Number.isInteger(sets) || sets < 1 || sets > 20) return "Sätze: eine ganze Zahl von 1 bis 20.";
  if (!draft.reps.trim()) return "Wiederholungen fehlen.";
  return null;
};

/**
 * The exercise an addition appends. Only what the user confirmed is written,
 * and no field is ever `undefined` (Firestore refuses those).
 */
export const buildNewExercise = (name: string, draft: PrescriptionDraft): Exercise => {
  const exercise: Exercise = {
    name: name.trim(),
    sets: Number(draft.sets.trim()),
    reps: draft.reps.trim(),
  };
  const rest = draft.rest.trim();
  if (rest) exercise.rest = rest;
  return exercise;
};

/** The main muscle group the repository knows for an exercise, or null. */
export const primaryMuscle = (name: string): string | null => {
  const subtitle = formatExerciseMuscleSubtitle(name);
  const first = subtitle?.split(",")[0]?.trim();
  return first ? first : null;
};

export interface CatalogueEntryLike {
  id: string;
  name: string;
}

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * Catalogue entries that train the same main muscle group as `current`,
 * judged only by the repository's reviewed muscle data. An exercise it does
 * not know gets no suggestions rather than a guess. The exercise itself and
 * the day's other exercises are left out.
 */
export const similarCatalogueEntries = <T extends CatalogueEntryLike>(
  current: string,
  catalogue: readonly T[],
  dayExerciseNames: readonly string[] = [],
  max = 6
): T[] => {
  const muscle = primaryMuscle(current);
  if (!muscle) return [];
  const excluded = new Set([current, ...dayExerciseNames].map(normalizeName));
  return catalogue
    .filter((entry) => !excluded.has(normalizeName(entry.name)) && primaryMuscle(entry.name) === muscle)
    .slice(0, max);
};

/** Case-insensitive name search; an empty query returns the whole catalogue. */
export const searchCatalogue = <T extends CatalogueEntryLike>(catalogue: readonly T[], search: string): T[] => {
  const needle = normalizeName(search);
  if (!needle) return [...catalogue];
  return catalogue.filter((entry) => normalizeName(entry.name).includes(needle));
};

export interface SessionDayLike {
  planId: string | null | undefined;
  weekKey: string | null | undefined;
  dayIndex: number | null | undefined;
}

/**
 * Whether a running workout executes the exercises of the plan day being
 * edited. The workout reads its exercises live from that day, and its set
 * completion, drafts and rest timer are all keyed by exercise position, so a
 * structural edit there would change the live session under the user. A
 * mirrored week (one with no content of its own) executes its source week's
 * day, so editing that source counts too.
 */
export const isDayLockedBySession = (
  session: SessionDayLike | null | undefined,
  planId: string | null | undefined,
  content: WorkoutPlanContent | undefined,
  edited: { weekKey: string; dayIndex: number }
): boolean => {
  if (!session || !planId || session.planId !== planId) return false;
  if (typeof session.weekKey !== "string" || session.dayIndex !== edited.dayIndex) return false;
  const executed = displayedSourceWeek(content, normalizeWeekKey(session.weekKey)) ?? normalizeWeekKey(session.weekKey);
  return executed === normalizeWeekKey(edited.weekKey);
};
