import type { Exercise } from '@/lib/types';

export type ExerciseField = 'sets' | 'reps' | 'weight' | 'rest' | 'distance' | 'duration';

/**
 * Field definitions for the exercises the inline editor knows by name. Names are
 * matched byte-exact; `Rudern` deliberately appears twice and the cardio entry wins,
 * which is the behaviour the editor has always had.
 */
export const PREDEFINED_EXERCISES_WITH_FIELDS = [
  // Cardio
  { name: 'Laufen', type: 'cardio', icon: '🏃', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Radfahren', type: 'cardio', icon: '🚴', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Schwimmen', type: 'cardio', icon: '🏊', fields: ['distance', 'duration'] as ExerciseField[] },
  { name: 'Rudern', type: 'cardio', icon: '🚣', fields: ['distance', 'duration'] as ExerciseField[] },
  // Upper Body - Push
  { name: 'Bankdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Schrägbankdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Schulterdrücken', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Liegestütze', type: 'strength', icon: '💪', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Dips', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  // Upper Body - Pull
  { name: 'Klimmzüge', type: 'strength', icon: '💪', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Latziehen', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Rudern', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Bizepscurls', type: 'strength', icon: '💪', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  // Lower Body
  { name: 'Kniebeugen', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Kreuzheben', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight', 'rest'] as ExerciseField[] },
  { name: 'Beinpresse', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Ausfallschritte', type: 'strength', icon: '🦵', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Beinbeuger', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Beinstrecker', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  { name: 'Wadenheben', type: 'strength', icon: '🦵', fields: ['sets', 'reps', 'weight'] as ExerciseField[] },
  // Core
  { name: 'Planks', type: 'strength', icon: '🧘', fields: ['duration', 'sets'] as ExerciseField[] },
  { name: 'Crunches', type: 'strength', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
  { name: 'Russian Twists', type: 'strength', icon: '🧘', fields: ['sets', 'reps'] as ExerciseField[] },
] as const;

export type PredefinedExerciseWithFields = (typeof PREDEFINED_EXERCISES_WITH_FIELDS)[number];

/** Reads the distance/duration the editor stores inside an exercise description. */
export const parseDescription = (desc: string) => {
  const distanceMatch = desc.match(/(\d+(?:\.\d+)?)\s*km/i);
  const durationMatch = desc.match(/(\d+)\s*min/i);
  return {
    distance: distanceMatch ? distanceMatch[1] : '',
    duration: durationMatch ? durationMatch[1] : '',
  };
};

/** The description shape the editor writes back when distance/duration are edited. */
export const formatDescription = (distance: string, duration: string) => {
  const parts = [];
  if (distance) parts.push(`${distance}km`);
  if (duration) parts.push(`${duration}min`);
  return parts.join(' / ');
};

export const findExerciseDefinition = (
  name: string | undefined,
): PredefinedExerciseWithFields | undefined =>
  PREDEFINED_EXERCISES_WITH_FIELDS.find((ex) => ex.name === name);

/*
  Plan data is not always typed as strictly as the Exercise interface claims: AI-generated
  and imported plans can carry numeric reps or weights. Treat both shapes as real values so
  the fallback preserves them rather than dropping them on a typeof check.
*/
const hasValue = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && value.trim().length > 0;
};

/*
  A description only earns distance/duration controls when it is already exactly what
  formatDescription would have written ("5km", "30min", "5km / 30min"). Prose that merely
  mentions "5 km" parses to the same numbers but does not round-trip, and exposing the
  control there would let a single blur rewrite the prose away.
*/
const isMachineWrittenDescription = (description: string | undefined): boolean => {
  if (typeof description !== 'string' || description.trim().length === 0) return false;
  const trimmed = description.trim();
  const { distance, duration } = parseDescription(trimmed);
  return formatDescription(distance, duration) === trimmed;
};

/** Canonical order so the editor renders the same controls in the same places. */
const FIELD_ORDER: ExerciseField[] = ['sets', 'reps', 'weight', 'rest', 'distance', 'duration'];

/**
 * Which parameter controls the inline editor should offer for an exercise.
 *
 * A known name keeps its catalogue definition unchanged. An unknown name — a grip or
 * machine variant, a translation, an AI-generated movement — falls back to whatever
 * prescription the exercise already carries, so valid data stays visible and editable
 * instead of disappearing behind a failed string match. The fallback reads the exercise
 * and never writes to it, and it never guesses from the name.
 */
export const resolveExerciseFields = (
  exercise: Pick<Exercise, 'name' | 'sets' | 'reps' | 'weight' | 'rest' | 'description'> | null | undefined,
): ExerciseField[] => {
  if (!exercise) return [];

  const known = findExerciseDefinition(exercise.name);
  if (known) return [...known.fields];

  const derived = new Set<ExerciseField>();
  if (typeof exercise.sets === 'number' && Number.isFinite(exercise.sets) && exercise.sets > 0) {
    derived.add('sets');
  }
  if (hasValue(exercise.reps)) derived.add('reps');
  if (hasValue(exercise.weight)) derived.add('weight');
  if (hasValue(exercise.rest)) derived.add('rest');
  if (isMachineWrittenDescription(exercise.description)) {
    const { distance, duration } = parseDescription(exercise.description!.trim());
    if (distance) derived.add('distance');
    if (duration) derived.add('duration');
  }

  return FIELD_ORDER.filter((field) => derived.has(field));
};
