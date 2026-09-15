import benchPressGraphic from '@/assets/exercise-thumbnails/bench-press.svg';
import { normalizeExerciseName } from './exerciseName';

export interface ExercisePresentation {
  readonly canonicalKey: string;
  readonly aliases: readonly string[];
  readonly thumbnail?: {
    readonly src: string;
    readonly source: string;
    readonly status: 'final' | 'temporary-graphic';
  };
}

/** Reviewed exact identities only. Independent of guidance and the remote catalogue. */
export const exercisePresentations: readonly ExercisePresentation[] = [
  {
    canonicalKey: 'bankdrücken',
    aliases: ['Bench Press'],
    thumbnail: {
      src: benchPressGraphic,
      source: 'Original local bench-press schematic, TRAINING-UI-01',
      status: 'temporary-graphic',
    },
  },
];

const presentations = new Map(exercisePresentations.flatMap(entry =>
  [entry.canonicalKey, ...entry.aliases].map(name => [normalizeExerciseName(name), entry] as const)));

export function resolveExercisePresentation(name: string): ExercisePresentation | undefined {
  return presentations.get(normalizeExerciseName(name));
}

/** A monogram plus identity-derived mosaic, never a guessed exercise illustration. */
export function exerciseThumbnailFallback(name: string) {
  const identity = resolveExercisePresentation(name)?.canonicalKey ?? normalizeExerciseName(name);
  const words = identity.split(/[\s-]+/u).filter(Boolean);
  const initials = (words.length > 1
    ? words.slice(0, 3).map(word => Array.from(word)[0]).join('')
    : Array.from(identity).slice(0, 2).join('')).toUpperCase() || '?';
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return { identity, initials, pattern: hash >>> 0 };
}
