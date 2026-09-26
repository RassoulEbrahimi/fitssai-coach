/**
 * The one definition of a fitness goal.
 *
 * Environment-independent, so Coaching and Nutrition V2 read goals through the
 * same vocabulary and the same alias table. German labels and select options
 * live with the client in `src/lib/coaching/fitnessGoal.ts`.
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
