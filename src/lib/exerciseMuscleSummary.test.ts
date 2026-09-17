import { describe, expect, it } from 'vitest';
import { exerciseDetails } from '@/lib/exerciseGuidance';
import { exercisePresentations } from '@/lib/exercisePresentation';
import { exerciseMuscleGroups, formatExerciseMuscleSubtitle } from '@/lib/exerciseMuscleSummary';

/*
  TRAINING-UI-06: the short line under an exercise name in the running workout.
  Display text only - it is never written, compared or used to resolve anything.
*/

describe('exercise muscle subtitle', () => {
  it.each([
    ['Bankdrücken', 'Brust, Trizeps'],
    ['Liegestütze', 'Brust, Trizeps'],
    ['Klimmzüge', 'Rücken, Bizeps'],
    ['Plank', 'Bauch'],
    ['Crunches', 'Bauch'],
  ])('derives %s from its reviewed anatomy as %s', (name, subtitle) => {
    expect(formatExerciseMuscleSubtitle(name)).toBe(subtitle);
  });

  it.each([
    ['Seitheben', 'Schultern'],
    ['Kniebeugen', 'Beine, Gesäß'],
    ['Hip Thrust', 'Gesäß, Beine'],
    ['Wadenheben', 'Waden'],
    ['Bizepscurls', 'Bizeps'],
    ['Trizepsdrücken', 'Trizeps'],
    ['Laufen', 'Ausdauer'],
    ['Burpees', 'Ganzkörper'],
  ])('names the groups %s trains as %s', (name, subtitle) => {
    expect(formatExerciseMuscleSubtitle(name)).toBe(subtitle);
  });

  it.each([
    ['Bench Press', 'Brust, Trizeps'],
    ['Pull-up', 'Rücken, Bizeps'],
    ['Planks', 'Bauch'],
    ['Squat', 'Beine, Gesäß'],
    ['Leg Curl', 'Beine'],
    ['Lockerer Dauerlauf', 'Ausdauer'],
  ])('resolves the alias %s the same way', (alias, subtitle) => {
    expect(formatExerciseMuscleSubtitle(alias)).toBe(subtitle);
  });

  it('stays with what a movement is mainly for when it has several primary groups', () => {
    // Plank's anatomy also lists shoulder stabilisers; two words would overstate them.
    expect(formatExerciseMuscleSubtitle('Plank')).toBe('Bauch');
    expect(formatExerciseMuscleSubtitle('Plank')).not.toContain('Schultern');
  });

  it.each([
    'Brustpresse Maschine',
    'Assault Bike',
    '',
    '   ',
  ])('has no line for %s, which the repository does not know', (name) => {
    expect(formatExerciseMuscleSubtitle(name)).toBeUndefined();
  });

  it('covers every catalogue identity, in at most two words', () => {
    for (const entry of exercisePresentations) {
      const subtitle = formatExerciseMuscleSubtitle(entry.canonicalKey);
      expect(`${entry.canonicalKey}: ${subtitle}`).toBe(`${entry.canonicalKey}: ${exerciseMuscleGroups[entry.canonicalKey]}`);
      expect(subtitle).toBeTruthy();
      expect(subtitle!.split(', ')).toHaveLength(subtitle!.includes(',') ? 2 : 1);
      expect(subtitle!.length).toBeLessThanOrEqual(24);
    }
  });

  it('keeps the compact map and the reviewed anatomy saying the same thing', () => {
    for (const detail of exerciseDetails) {
      const mapped = exerciseMuscleGroups[detail.canonicalKey];
      if (mapped === undefined) continue;
      expect(`${detail.canonicalKey}: ${formatExerciseMuscleSubtitle(detail.title)}`).toBe(`${detail.canonicalKey}: ${mapped}`);
    }
  });

  it('never repeats a word, whatever the source', () => {
    for (const entry of exercisePresentations) {
      const words = formatExerciseMuscleSubtitle(entry.canonicalKey)!.split(', ');
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it('holds no entry for an identity the catalogue does not have', () => {
    const identities = new Set(exercisePresentations.map((entry) => entry.canonicalKey));
    expect(Object.keys(exerciseMuscleGroups).filter((key) => !identities.has(key))).toEqual([]);
  });
});
