/**
 * Client presentation of a fitness goal: German labels and select options.
 *
 * The vocabulary and the normaliser are shared with Nutrition V2 and live in
 * `shared/fitnessGoal.ts`; they are re-exported here unchanged, so every
 * existing caller keeps importing from this module.
 */
import { FITNESS_GOALS, normaliseFitnessGoal, type FitnessGoal } from "@shared/fitnessGoal";

export { FITNESS_GOALS, isFitnessGoal, normaliseFitnessGoal } from "@shared/fitnessGoal";
export type { FitnessGoal } from "@shared/fitnessGoal";

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
