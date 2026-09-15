import { describe, expect, it } from 'vitest';
import { exercisePresentations, exerciseThumbnailFallback, resolveExercisePresentation } from './exercisePresentation';
import { resolveExerciseDetail } from './exerciseGuidance';

describe('exercise presentation identity', () => {
  it('resolves an imported local asset and only reviewed aliases', () => {
    const entry = resolveExercisePresentation('  BANKDRÜCKEN  ');
    expect(entry).toBe(exercisePresentations[0]);
    expect(entry?.thumbnail?.src).toContain('bench-press.svg');
    expect(entry?.thumbnail?.status).toBe('temporary-graphic');
    expect(resolveExercisePresentation('Bench   Press')).toBe(entry);
  });

  it.each(['Bankdrücken schräg Multipresse', 'Schrägbankdrücken', 'Bankdrucken', 'Bench Press close grip', 'Unbekannt'])(
    'does not guess an asset for %s', name => expect(resolveExercisePresentation(name)).toBeUndefined());

  it('uses stable distinct fallback identities, including names with identical initials', () => {
    expect(exerciseThumbnailFallback(' Bench Press ')).toEqual(exerciseThumbnailFallback('Bankdrücken'));
    expect(exerciseThumbnailFallback('Bizepscurls')).not.toEqual(exerciseThumbnailFallback('Beinheben'));
    expect(exerciseThumbnailFallback('Bankdrücken schräg Multipresse').initials).toBe('BSM');
    expect(exerciseThumbnailFallback('')).toMatchObject({ initials: '?' });
  });

  it('resolves thumbnails independently of guidance coverage', () => {
    expect(resolveExerciseDetail('Crunches')).toBeDefined();
    expect(resolveExercisePresentation('Crunches')).toBeUndefined();
    // Guidance aliases are not presentation aliases.
    expect(resolveExerciseDetail('Pull-up')).toBeDefined();
    expect(resolveExercisePresentation('Pull-up')).toBeUndefined();
  });

  it('has no duplicate normalized identities or remote assets', () => {
    const names = exercisePresentations.flatMap(entry => [entry.canonicalKey, ...entry.aliases]);
    expect(new Set(names.map(name => name.toLowerCase())).size).toBe(names.length);
    for (const entry of exercisePresentations) expect(entry.thumbnail?.src).not.toMatch(/^https?:/);
  });
});
