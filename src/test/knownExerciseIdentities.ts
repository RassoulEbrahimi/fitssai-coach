/**
 * The exercise names this repository knows, rebuilt from source for TRAINING-UI-01B.
 *
 * This is the coverage baseline: `exercisePresentation.test.ts` requires every
 * name here to resolve to a local thumbnail, so an identity cannot quietly lose
 * its artwork. It is deliberately a reviewed list rather than a scrape, but it
 * is kept honest by tests that assert the production name lists
 * (`PREDEFINED_EXERCISES_WITH_FIELDS`, the guidance registry) are a subset of it.
 *
 * Inclusion: names used as exercise data — production lists, plan, session,
 * editor and catalogue fixtures, category inputs, Functions plan fixtures, and
 * the TRAINING-UI-01 long names.
 *
 * Exclusion, with reasons in docs/TRAINING-UI-01B-thumbnail-assets.md: spelling,
 * case, whitespace and transliteration probes; "unknown exercise" placeholders;
 * names that exist only to prove a resolver does not match them; and the
 * Functions equipment-inference probes.
 *
 * The production catalogue itself lives in Firestore, so names outside this list
 * can reach the UI at runtime and use the deterministic fallback.
 */
export interface KnownExerciseIdentity {
  /** The name as written in the repository. Matching is exact after normalisation. */
  readonly name: string;
  /** Where the name is used, for review. */
  readonly sources: readonly string[];
}

export const knownExerciseIdentities: readonly KnownExerciseIdentity[] = [
  // --- Chest ---
  { name: 'Bankdrücken', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseGuidance.ts', 'functions/src/plan.fixtures.ts'] },
  { name: 'Bench Press', sources: ['src/lib/exerciseGuidance.ts', 'src/lib/exerciseEditorTestUtils.ts'] },
  { name: 'Bankdrücken enger Griff', sources: ['src/components/InlineEditableExercise.test.tsx', 'src/lib/exerciseFields.test.ts'] },
  { name: 'Schrägbankdrücken', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Bankdrücken schräg Multipresse', sources: ['src/components/workout/ExerciseWithSets.test.tsx'] },
  { name: 'Liegestütze', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseGuidance.ts'] },
  { name: 'Push-ups', sources: ['src/lib/exerciseGuidance.ts', 'src/lib/exerciseEditorTestUtils.ts'] },
  { name: 'Butterfly', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Dips', sources: ['src/lib/exerciseFields.ts', 'src/lib/workoutExecution.test.ts'] },

  // --- Shoulders ---
  { name: 'Schulterdrücken', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Overhead Press', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Kurzhantel-Schulterdrücken', sources: ['functions/src/coaching/generatePlan.test.ts', 'functions/src/coaching/planIdempotency.test.ts'] },
  { name: 'Seitheben', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Seitheben am Kabelzug', sources: ['src/components/InlineEditableExercise.test.tsx', 'src/lib/exerciseFields.test.ts'] },
  { name: 'Reverse Butterfly', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Face Pull', sources: ['src/lib/exerciseCategories.test.ts'] },

  // --- Back ---
  { name: 'Klimmzüge', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseGuidance.ts', 'functions/src/coaching/generatePlan.test.ts'] },
  { name: 'Pull-up', sources: ['src/lib/exerciseGuidance.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Pull-ups', sources: ['src/lib/exerciseEditorTestUtils.ts'] },
  { name: 'Latziehen', sources: ['src/lib/exerciseFields.ts'] },
  { name: 'Latzug', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Lat Pulldown', sources: ['src/test/historicalExerciseIdentity.test.tsx'] },
  { name: 'Rudern', sources: ['src/lib/exerciseFields.ts', 'functions/src/plan.fixtures.ts', 'src/lib/workoutExecution.test.ts'] },
  { name: 'Row', sources: ['src/test/historicalExerciseIdentity.test.tsx'] },
  { name: 'Barbell Row', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Kurzhantel-Rudern', sources: ['functions/src/coaching/generatePlan.test.ts', 'functions/src/coaching/semanticValidation.test.ts'] },
  { name: 'Einarmiges Kabelrudern am Seilzug', sources: ['src/components/InlineEditableExercise.test.tsx', 'src/lib/exerciseFields.test.ts'] },
  { name: 'Überzüge', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Rückenstrecker', sources: ['src/lib/exerciseCategories.test.ts', 'src/components/ExerciseSelector.test.tsx'] },
  { name: 'Back Extension', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Superman', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Good Morning', sources: ['src/lib/exerciseCategories.test.ts'] },

  // --- Legs and hips ---
  { name: 'Kniebeugen', sources: ['src/lib/exerciseFields.ts', 'src/lib/workoutExecution.test.ts'] },
  { name: 'Kniebeuge', sources: ['src/components/ExerciseSelector.test.tsx', 'functions/src/plan.schema.test.ts', 'rules-tests/firestore.rules.test.ts'] },
  { name: 'Squat', sources: ['src/lib/exerciseEditorTestUtils.ts', 'src/components/TodayWorkoutCard.test.tsx'] },
  { name: 'Langhantel-Kniebeuge', sources: ['functions/src/coaching/semanticValidation.test.ts'] },
  { name: 'Bulgarian Split Squat', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Ausfallschritte', sources: ['src/lib/exerciseFields.ts', 'functions/src/coaching/semanticValidation.test.ts'] },
  { name: 'Lunges', sources: ['src/lib/exerciseEditorTestUtils.ts'] },
  { name: 'Beinpresse', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Beinpresse 45° Plate Loaded', sources: ['src/components/workout/ExerciseThumbnail.test.tsx'] },
  { name: 'Beinstrecker', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Beinbeuger', sources: ['src/lib/exerciseFields.ts', 'src/components/ExerciseSelector.test.tsx'] },
  { name: 'Leg Curl', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Wadenheben', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Kreuzheben', sources: ['src/lib/exerciseFields.ts', 'src/test/sessionBoundExecution.test.tsx'] },
  { name: 'Deadlift', sources: ['src/lib/exerciseEditorTestUtils.ts'] },
  { name: 'Rumänisches Kreuzheben', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Hip Thrust', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Gesäßbrücke', sources: ['src/lib/exerciseCategories.test.ts'] },

  // --- Core ---
  { name: 'Plank', sources: ['src/lib/exerciseGuidance.ts', 'src/lib/workoutExecution.test.ts'] },
  { name: 'Planks', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseGuidance.ts'] },
  { name: 'Unterarmstütz', sources: ['src/lib/exerciseCategories.ts (classifier keyword)', 'TRAINING-UI-01 inventory'] },
  { name: 'Crunches', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseGuidance.ts'] },
  { name: 'Sit-ups', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Beinheben', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Russian Twist', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Russian Twists', sources: ['src/lib/exerciseFields.ts'] },

  // --- Arms ---
  { name: 'Bizepscurls', sources: ['src/lib/exerciseFields.ts', 'src/lib/exerciseCategories.test.ts'] },
  { name: 'Curl', sources: ['src/test/addWorkoutModalHistoryGuard.test.tsx'] },
  { name: 'Hammercurls', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Trizepsdrücken', sources: ['src/lib/exerciseCategories.test.ts'] },
  { name: 'Trizepsstrecken Kabelzug Kordel', sources: ['src/components/workout/ExerciseThumbnail.test.tsx'] },

  // --- Cardio and conditioning ---
  { name: 'Laufen', sources: ['src/lib/exerciseFields.ts', 'src/components/InlineEditableExercise.test.tsx'] },
  { name: 'Lockerer Dauerlauf', sources: ['src/components/InlineEditableExercise.test.tsx', 'src/lib/exerciseFields.test.ts'] },
  { name: 'Intervalllauf', sources: ['src/lib/exerciseFields.test.ts'] },
  { name: 'Laufen im Gelände', sources: ['src/components/InlineEditableExercise.test.tsx', 'src/lib/exerciseFields.test.ts'] },
  { name: 'Radfahren', sources: ['src/lib/exerciseFields.ts', 'src/components/InlineEditableExercise.test.tsx'] },
  { name: 'Schwimmen', sources: ['src/lib/exerciseFields.ts'] },
  { name: 'Seilspringen', sources: ['src/components/ExerciseSelector.test.tsx'] },
  { name: 'Burpees', sources: ['src/components/ExerciseSelector.test.tsx'] },
  { name: 'Farmers Walk', sources: ['src/lib/exerciseCategories.test.ts', 'src/components/ExerciseSelector.test.tsx'] },
];
