import { describe, it, expect } from 'vitest';
import type { Exercise } from '@/lib/types';
import {
  PREDEFINED_EXERCISES_WITH_FIELDS,
  findExerciseDefinition,
  formatDescription,
  parseDescription,
  resolveExerciseFields,
} from './exerciseFields';

const exercise = (overrides: Partial<Exercise> & { name: string }): Exercise => ({
  sets: 3,
  reps: '10',
  ...overrides,
});

describe('exact catalogue matches keep their definition', () => {
  it('returns the strength fields for a known strength exercise', () => {
    expect(resolveExerciseFields(exercise({ name: 'Bankdrücken' }))).toEqual([
      'sets',
      'reps',
      'weight',
      'rest',
    ]);
  });

  it('returns only distance and duration for a known cardio exercise', () => {
    const fields = resolveExerciseFields(
      exercise({ name: 'Laufen', description: '5km / 30min' }),
    );
    expect(fields).toEqual(['distance', 'duration']);
    expect(fields).not.toContain('weight');
    expect(fields).not.toContain('rest');
  });

  it('keeps a known cardio exercise cardio even when it carries strength data', () => {
    // Stray sets/reps/weight must not turn Laufen into a strength exercise.
    const fields = resolveExerciseFields(
      exercise({ name: 'Laufen', sets: 4, reps: '12', weight: '20', rest: '90s' }),
    );
    expect(fields).toEqual(['distance', 'duration']);
  });

  it('resolves the duplicated Rudern name to the cardio entry, as before', () => {
    expect(findExerciseDefinition('Rudern')?.type).toBe('cardio');
    expect(resolveExerciseFields(exercise({ name: 'Rudern' }))).toEqual(['distance', 'duration']);
  });

  it('does not broaden a known exercise that defines fewer fields', () => {
    expect(
      resolveExerciseFields(exercise({ name: 'Liegestütze', weight: '20', rest: '60s' })),
    ).toEqual(['sets', 'reps']);
    expect(resolveExerciseFields(exercise({ name: 'Planks' }))).toEqual(['duration', 'sets']);
  });

  it('matches every catalogue entry exactly as declared', () => {
    for (const entry of PREDEFINED_EXERCISES_WITH_FIELDS) {
      const resolved = resolveExerciseFields(exercise({ name: entry.name }));
      expect(resolved).toEqual([...findExerciseDefinition(entry.name)!.fields]);
    }
  });
});

describe('unmatched names fall back to the data already on the exercise', () => {
  it('keeps a full prescription on a grip variant of a known lift', () => {
    expect(
      resolveExerciseFields(
        exercise({
          name: 'Bankdrücken enger Griff',
          sets: 4,
          reps: '8',
          weight: '60',
          rest: '120s',
        }),
      ),
    ).toEqual(['sets', 'reps', 'weight', 'rest']);
  });

  it('keeps a full prescription on an AI-generated movement name', () => {
    expect(
      resolveExerciseFields(
        exercise({
          name: 'Einarmiges Kabelrudern am Seilzug',
          sets: 3,
          reps: '12',
          weight: '25',
          rest: '75s',
        }),
      ),
    ).toEqual(['sets', 'reps', 'weight', 'rest']);
  });

  it('invents nothing when only sets and reps are supplied', () => {
    expect(
      resolveExerciseFields(exercise({ name: 'Seitheben am Kabelzug', sets: 3, reps: '15' })),
    ).toEqual(['sets', 'reps']);
  });

  it('treats empty and whitespace-only values as absent', () => {
    expect(
      resolveExerciseFields(
        exercise({ name: 'Unbekannte Übung', weight: '', rest: '   ', description: '' }),
      ),
    ).toEqual(['sets', 'reps']);
  });

  it('drops sets when the exercise carries no usable set count', () => {
    expect(
      resolveExerciseFields(exercise({ name: 'Unbekannte Übung', sets: 0, reps: '20' })),
    ).toEqual(['reps']);
  });

  it('preserves numeric reps and weights from loosely typed plan data', () => {
    const loose = { name: 'Unbekannte Übung', sets: 3, reps: 12, weight: 40 } as unknown as Exercise;
    expect(resolveExerciseFields(loose)).toEqual(['sets', 'reps', 'weight']);
  });

  it('exposes distance and duration for a machine-written description', () => {
    expect(
      resolveExerciseFields({
        name: 'Laufen im Gelände',
        sets: 1,
        reps: '1',
        description: '5km / 30min',
      }),
    ).toEqual(['sets', 'reps', 'distance', 'duration']);
  });

  it('exposes only the half of the description that is present', () => {
    expect(
      resolveExerciseFields({ name: 'Intervalllauf', sets: 0, reps: '', description: '30min' }),
    ).toEqual(['duration']);
  });

  it('leaves a prose description alone rather than risking overwriting it', () => {
    // The control writes back "5km" on blur, which would destroy the surrounding prose.
    expect(
      resolveExerciseFields({
        name: 'Lockerer Dauerlauf',
        sets: 0,
        reps: '',
        description: 'Locker 5 km im Grundlagenbereich laufen',
      }),
    ).toEqual([]);
  });

  it('returns an empty list for an exercise with no prescription at all', () => {
    expect(resolveExerciseFields({ name: 'Unbekannte Übung', sets: 0, reps: '' })).toEqual([]);
  });

  it('tolerates a missing exercise', () => {
    expect(resolveExerciseFields(undefined)).toEqual([]);
    expect(resolveExerciseFields(null)).toEqual([]);
  });

  it('does not mutate the exercise it inspects', () => {
    const input = exercise({ name: 'Bankdrücken enger Griff', weight: '60', rest: '120s' });
    const snapshot = structuredClone(input);
    resolveExerciseFields(input);
    expect(input).toEqual(snapshot);
  });
});

describe('description round-tripping', () => {
  it('parses the values the editor writes', () => {
    expect(parseDescription('5km / 30min')).toEqual({ distance: '5', duration: '30' });
    expect(parseDescription('7.5 km')).toEqual({ distance: '7.5', duration: '' });
    expect(parseDescription('')).toEqual({ distance: '', duration: '' });
  });

  it('formats only the parts that are set', () => {
    expect(formatDescription('5', '30')).toBe('5km / 30min');
    expect(formatDescription('', '30')).toBe('30min');
    expect(formatDescription('5', '')).toBe('5km');
    expect(formatDescription('', '')).toBe('');
  });
});
