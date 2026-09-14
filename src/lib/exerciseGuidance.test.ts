import { describe, expect, it } from 'vitest';
import { exerciseDetails, normalizeExerciseName, resolveExerciseDetail } from './exerciseGuidance';

describe('reviewed exercise guidance lookup', () => {
  it.each([
    [' BANKDRÜCKEN ', 'bankdrücken'], ['Bench   Press', 'bankdrücken'],
    ['Push-ups', 'liegestütze'], ['Push‑ups', 'liegestütze'],
    ['Pull-up', 'klimmzüge'], ['Planks', 'plank'], ['Crunches', 'crunches'],
    ['Klimmzu\u0308ge', 'klimmzüge'],
  ])('resolves the explicit name or alias %s', (name, key) => {
    expect(resolveExerciseDetail(name)?.canonicalKey).toBe(key);
  });

  it.each(['', 'Row', 'Schrägbankdrücken', 'Bankdrücken enger Griff', 'Bench Press Machine',
    'Push-ups auf Knien', 'Pushups', 'Side Plank', 'Crunch', 'Chin-up', 'toString', '__proto__'])(
    'does not guess details for %s', name => expect(resolveExerciseDetail(name)).toBeUndefined());

  it('keeps all reviewed names collision-free and resolves every entry', () => {
    const names = exerciseDetails.flatMap(detail => [detail.title, ...detail.aliases].map(normalizeExerciseName));
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(exerciseDetails.map(detail => detail.canonicalKey)).size).toBe(exerciseDetails.length);
    for (const detail of exerciseDetails) {
      expect(resolveExerciseDetail(detail.title)).toBe(detail);
      expect(detail.execution.setup.length).toBeGreaterThan(0);
      expect(detail.execution.steps.length).toBeGreaterThan(0);
      expect(detail.muscles.primary.length).toBeGreaterThan(0);
      expect(detail.muscles.secondary.some(m => detail.muscles.primary.includes(m))).toBe(false);
    }
  });
});
