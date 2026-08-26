/**
 * The one definition of a fitness goal.
 *
 * `fitnessGoal` on a user document holds values from more than one era.
 * Onboarding writes camelCase; the profile's goal dialog historically wrote
 * snake_case; and the German message catalogue additionally carries kebab-case
 * keys. Nothing is rewritten in Firestore — instead every reader normalises at
 * the boundary, so the coaching layer only ever sees canonical values.
 *
 * Onboarding's vocabulary is canonical because it is what new profiles carry.
 */

export const FITNESS_GOALS = ["gainMuscle", "loseFat", "improveCardio", "maintain"] as const;

export type FitnessGoal = (typeof FITNESS_GOALS)[number];

/**
 * Every stored spelling seen in the wild, mapped to canonical.
 *
 * Canonical values map to themselves so normalising twice is safe.
 */
const GOAL_ALIASES: Readonly<Record<string, FitnessGoal>> = {
  gainMuscle: "gainMuscle",
  loseFat: "loseFat",
  improveCardio: "improveCardio",
  maintain: "maintain",

  // Written by the profile goal dialog before PR49.
  muscle_gain: "gainMuscle",
  weight_loss: "loseFat",
  endurance: "improveCardio",
  maintenance: "maintain",

  // Present as keys in the message catalogue.
  "gain-muscle": "gainMuscle",
  "lose-fat": "loseFat",
  "improve-cardio": "improveCardio",
};

/**
 * Canonical goal for a stored value, or `undefined` when it is unrecognised.
 *
 * Never guesses. An unknown value means the goal is unknown, and every caller
 * has to work without one — which they all do.
 */
export const normaliseFitnessGoal = (value: unknown): FitnessGoal | undefined => {
  if (typeof value !== "string") return undefined;
  return GOAL_ALIASES[value.trim()];
};

export const isFitnessGoal = (value: unknown): value is FitnessGoal =>
  typeof value === "string" && (FITNESS_GOALS as readonly string[]).includes(value);

const GOAL_LABELS: Readonly<Record<FitnessGoal, string>> = {
  gainMuscle: "Muskeln aufbauen",
  loseFat: "Fett verlieren",
  improveCardio: "Kardio verbessern",
  maintain: "Halten",
};

/**
 * German label for any stored spelling.
 *
 * Returns null when the value is unrecognised, so the caller decides what to
 * show rather than a raw identifier leaking into the UI — which is what
 * happened to profiles carrying the canonical spelling, since the profile's
 * label map only covered the snake_case era.
 */
export const fitnessGoalLabel = (value: unknown): string | null => {
  const goal = normaliseFitnessGoal(value);
  return goal ? GOAL_LABELS[goal] : null;
};

export interface FitnessGoalOption {
  value: FitnessGoal;
  label: string;
}

/** For selects. Canonical values only — new writes never use a legacy spelling. */
export const FITNESS_GOAL_OPTIONS: readonly FitnessGoalOption[] = FITNESS_GOALS.map((value) => ({
  value,
  label: GOAL_LABELS[value],
}));
