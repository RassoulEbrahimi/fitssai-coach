import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exercisePresentations, exerciseThumbnailFallback, resolveExercisePresentation } from './exercisePresentation';
import { exerciseDetails, resolveExerciseDetail } from './exerciseGuidance';
import { normalizeExerciseName } from './exerciseName';
import { PREDEFINED_EXERCISES_WITH_FIELDS } from './exerciseFields';
import { knownExerciseIdentities } from '@/test/knownExerciseIdentities';

const thumbnailOf = (name: string) => resolveExercisePresentation(name)?.thumbnail?.src;
const inventory = new Set(knownExerciseIdentities.map(identity => normalizeExerciseName(identity.name)));
const registered = exercisePresentations.flatMap(entry => [entry.canonicalKey, ...entry.aliases]);

describe('exercise presentation coverage', () => {
  it.each(knownExerciseIdentities.map(identity => identity.name))(
    'resolves %s to reviewed local artwork', name => {
      const entry = resolveExercisePresentation(name);
      expect(entry?.thumbnail?.status).toBe('final');
      expect(entry?.thumbnail?.src).toMatch(/exercise-thumbnails\/[a-z0-9-]+\.svg/);
    });

  it('covers the whole known inventory', () => {
    const covered = knownExerciseIdentities.filter(identity => thumbnailOf(identity.name));
    expect(covered.length).toBe(knownExerciseIdentities.length);
  });

  it('registers no name outside the reviewed inventory', () => {
    for (const name of registered) expect(inventory.has(normalizeExerciseName(name))).toBe(true);
  });

  it('keeps the production name lists inside the inventory', () => {
    const production = [
      ...PREDEFINED_EXERCISES_WITH_FIELDS.map(exercise => exercise.name),
      ...exerciseDetails.flatMap(detail => [detail.title, ...detail.aliases]),
    ];
    for (const name of production) expect(inventory.has(normalizeExerciseName(name))).toBe(true);
  });
});

describe('exercise presentation identity', () => {
  it.each([
    ['Bankdrücken', 'Bench Press'],
    ['Klimmzüge', 'Pull-up'],
    ['Klimmzüge', 'Pull-ups'],
    ['Latziehen', 'Lat Pulldown'],
    ['Latziehen', 'Latzug'],
    ['Kniebeugen', 'Squat'],
    ['Kniebeugen', 'Langhantel-Kniebeuge'],
    ['Plank', 'Unterarmstütz'],
    ['Laufen', 'Intervalllauf'],
    ['Rudern', 'Row'],
    ['Bizepscurls', 'Curl'],
  ])('shares one asset between %s and its reviewed alias %s', (canonical, alias) => {
    expect(resolveExercisePresentation(alias)).toBe(resolveExercisePresentation(canonical));
    expect(thumbnailOf(alias)).toBe(thumbnailOf(canonical));
  });

  it.each([
    // The qualifier changes the angle, the machine, the grip or the implement.
    ['Bankdrücken', 'Bankdrücken schräg Multipresse'],
    ['Bankdrücken', 'Schrägbankdrücken'],
    ['Bankdrücken', 'Bankdrücken enger Griff'],
    ['Schrägbankdrücken', 'Bankdrücken schräg Multipresse'],
    ['Beinpresse', 'Beinpresse 45° Plate Loaded'],
    ['Bizepscurls', 'Hammercurls'],
    ['Butterfly', 'Reverse Butterfly'],
    ['Trizepsdrücken', 'Trizepsstrecken Kabelzug Kordel'],
    ['Seitheben', 'Seitheben am Kabelzug'],
    ['Schulterdrücken', 'Kurzhantel-Schulterdrücken'],
    ['Rudern', 'Barbell Row'],
    ['Rudern', 'Kurzhantel-Rudern'],
    ['Rudern', 'Einarmiges Kabelrudern am Seilzug'],
    ['Beinstrecker', 'Beinbeuger'],
    ['Kreuzheben', 'Rumänisches Kreuzheben'],
    ['Hip Thrust', 'Gesäßbrücke'],
    ['Crunches', 'Sit-ups'],
    ['Liegestütze', 'Plank'],
    ['Laufen', 'Laufen im Gelände'],
    ['Klimmzüge', 'Latziehen'],
  ])('gives %s and %s different assets', (one, other) => {
    expect(thumbnailOf(one)).toBeDefined();
    expect(thumbnailOf(other)).toBeDefined();
    expect(thumbnailOf(one)).not.toBe(thumbnailOf(other));
  });

  it('matches exactly, ignoring only case and surrounding whitespace', () => {
    const entry = resolveExercisePresentation('  BANKDRÜCKEN  ');
    expect(entry).toBe(exercisePresentations[0]);
    expect(resolveExercisePresentation('Bench   Press')).toBe(entry);
  });

  it.each([
    'Bankdrucken', 'Bench Press close grip', 'Bench Press Machine', 'Chin-up', 'Side Plank',
    'Push-ups auf Knien', 'Crunch', 'Klimmzüge breit', 'Beinpresse 45°', 'Kabelzug-Rudern', 'Unbekannt', '',
  ])('does not guess an asset for %s', name => expect(resolveExercisePresentation(name)).toBeUndefined());

  it('uses stable distinct fallback identities, including names with identical initials', () => {
    expect(exerciseThumbnailFallback(' Bench Press ')).toEqual(exerciseThumbnailFallback('Bankdrücken'));
    expect(exerciseThumbnailFallback('Bizepscurls')).not.toEqual(exerciseThumbnailFallback('Beinheben'));
    expect(exerciseThumbnailFallback('Bankdrücken Maschine').initials).toBe('BM');
    expect(exerciseThumbnailFallback('')).toMatchObject({ initials: '?' });
  });

  it('resolves thumbnails independently of guidance coverage', () => {
    // Guidance covers five exercises; presentation covers the whole inventory.
    expect(resolveExerciseDetail('Beinstrecker')).toBeUndefined();
    expect(thumbnailOf('Beinstrecker')).toBeDefined();
    expect(resolveExerciseDetail('Pull-ups')).toBeUndefined();
    expect(thumbnailOf('Pull-ups')).toBeDefined();
    const source = readFileSync('src/lib/exercisePresentation.ts', 'utf8');
    expect(source).not.toContain('exerciseGuidance');
  });

  it('has no duplicate normalized identities and only local reviewed assets', () => {
    expect(new Set(registered.map(name => normalizeExerciseName(name))).size).toBe(registered.length);
    for (const entry of exercisePresentations) {
      expect(entry.thumbnail?.src).not.toMatch(/^https?:/);
      expect(entry.thumbnail?.source).toContain('Original local vector artwork');
    }
  });
});
