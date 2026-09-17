import { resolveExerciseDetail, type ExerciseDetail, type MuscleGroup } from './exerciseGuidance';
import { resolveExercisePresentation } from './exercisePresentation';

/**
 * The short muscle-group line under an exercise name in the running workout.
 *
 * It answers one question - what does this train? - in at most two words, so it
 * fits a 238px card. It is display text, not domain data: nothing here is
 * persisted, compared or used to pick a thumbnail, and an exercise the
 * repository does not know simply has no line.
 *
 * Two sources, in this order:
 * 1. `exerciseGuidance`, where an exercise has reviewed anatomy. The dialog's
 *    full labels ("Breiter Rückenmuskel") are too long for a subtitle, so the
 *    same groups are named in everyday words.
 * 2. `exerciseMuscleGroups` below, keyed by the canonical identity
 *    `exercisePresentation` already resolves, so aliases and spelling variants
 *    are covered by the existing matching rather than a second name list.
 */

/** One everyday word per guidance group. Several groups may share a word. */
const MUSCLE_WORDS: Readonly<Record<MuscleGroup, string>> = {
  chest: 'Brust',
  triceps: 'Trizeps',
  frontShoulders: 'Schultern',
  lats: 'Rücken',
  upperBack: 'Rücken',
  biceps: 'Bizeps',
  abs: 'Bauch',
  deepAbs: 'Bauch',
  obliques: 'Bauch',
  shoulderStabilizers: 'Schultern',
};

/**
 * Compact groups per canonical identity, for the catalogue entries that have no
 * guidance anatomy. Two words at most, the main one first. Conditioning
 * movements name what they train instead of a muscle; that is the honest short
 * answer for them and keeps the line the same shape everywhere.
 */
export const exerciseMuscleGroups: Readonly<Record<string, string>> = {
  // --- Chest ---
  'bankdrücken': 'Brust, Trizeps',
  'bankdrücken enger griff': 'Trizeps, Brust',
  'schrägbankdrücken': 'Brust, Schultern',
  'bankdrücken schräg multipresse': 'Brust, Schultern',
  'liegestütze': 'Brust, Trizeps',
  'butterfly': 'Brust',
  'dips': 'Brust, Trizeps',

  // --- Shoulders ---
  'schulterdrücken': 'Schultern, Trizeps',
  'kurzhantel-schulterdrücken': 'Schultern, Trizeps',
  'seitheben': 'Schultern',
  'seitheben am kabelzug': 'Schultern',
  'reverse butterfly': 'Schultern, Rücken',
  'face pull': 'Schultern, Rücken',

  // --- Back ---
  'klimmzüge': 'Rücken, Bizeps',
  'latziehen': 'Rücken, Bizeps',
  'rudern': 'Rücken, Bizeps',
  'barbell row': 'Rücken, Bizeps',
  'kurzhantel-rudern': 'Rücken, Bizeps',
  'einarmiges kabelrudern am seilzug': 'Rücken, Bizeps',
  'überzüge': 'Rücken, Brust',
  'rückenstrecker': 'Unterer Rücken, Gesäß',
  'superman': 'Unterer Rücken, Gesäß',
  'good morning': 'Beine, Unterer Rücken',

  // --- Legs and hips ---
  'kniebeugen': 'Beine, Gesäß',
  'bulgarian split squat': 'Beine, Gesäß',
  'ausfallschritte': 'Beine, Gesäß',
  'beinpresse': 'Beine, Gesäß',
  'beinpresse 45° plate loaded': 'Beine, Gesäß',
  'beinstrecker': 'Beine',
  'beinbeuger': 'Beine',
  'wadenheben': 'Waden',
  'kreuzheben': 'Rücken, Beine',
  'rumänisches kreuzheben': 'Beine, Gesäß',
  'hip thrust': 'Gesäß, Beine',
  'gesäßbrücke': 'Gesäß, Beine',

  // --- Core ---
  'plank': 'Bauch',
  'crunches': 'Bauch',
  'sit-ups': 'Bauch',
  'beinheben': 'Bauch',
  'russian twist': 'Bauch',

  // --- Arms ---
  'bizepscurls': 'Bizeps',
  'hammercurls': 'Bizeps, Unterarme',
  'trizepsdrücken': 'Trizeps',
  'trizepsstrecken kabelzug kordel': 'Trizeps',

  // --- Cardio and conditioning ---
  'laufen': 'Ausdauer',
  'laufen im gelände': 'Ausdauer',
  'radfahren': 'Ausdauer, Beine',
  'schwimmen': 'Ausdauer',
  'seilspringen': 'Ausdauer, Waden',
  'burpees': 'Ganzkörper',
  'farmers walk': 'Unterarme, Rücken',
};

/**
 * The primary groups as words, plus - when the movement has a single primary
 * group - the first helper it also trains. A movement already spread over
 * several primaries stays with what it is mainly for, so a plank reads "Bauch"
 * rather than "Bauch, Schultern".
 */
export function muscleWordsFromDetail(detail: ExerciseDetail): string[] {
  const words: string[] = [];
  const add = (group: MuscleGroup) => {
    const word = MUSCLE_WORDS[group];
    if (!words.includes(word)) words.push(word);
  };

  detail.muscles.primary.forEach(add);
  if (detail.muscles.primary.length === 1) {
    for (const group of detail.muscles.secondary) {
      if (words.length >= 2) break;
      add(group);
    }
  }
  return words;
}

/**
 * The subtitle for an exercise, or `undefined` when the repository does not
 * know the name. Callers omit the line entirely rather than inventing one.
 */
export function formatExerciseMuscleSubtitle(name: string): string | undefined {
  const detail = resolveExerciseDetail(name);
  if (detail) return muscleWordsFromDetail(detail).join(', ') || undefined;

  const identity = resolveExercisePresentation(name)?.canonicalKey;
  return identity ? exerciseMuscleGroups[identity] : undefined;
}
