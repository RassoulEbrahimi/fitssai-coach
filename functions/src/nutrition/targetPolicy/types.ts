import type {
  NutritionTargetMode,
  NutritionTargetProfileField,
  NutritionTargetProfileValues,
  NutritionValues,
} from "../../../../shared/nutrition";

/**
 * The seam every Nutrition target goes through.
 *
 * A target policy is the versioned rule that turns profile answers into the
 * four canonical TARGET values. Calculated and manual targets are both
 * policies: even a manual target needs signed-off bounds, and those bounds are
 * policy, not storage.
 *
 * A policy is a pure function of its input. It has no Firestore, no auth, no
 * clock, no provider and no randomness, it does not mutate its input, and it
 * names every profile field it reads in `requiredProfileFields` — the handler
 * gives it those fields and nothing else. Its result is validated against the
 * canonical `NutritionValues` schema before anything is stored.
 *
 * A policy that cannot produce a supported target from valid answers says so
 * by throwing `TargetInfeasibleError` — a deliberate refusal the caller
 * reports as `TARGET_INFEASIBLE`. Anything else a policy throws is an
 * internal failure.
 *
 * The signed-off policies (NUT-12C.1) live in `./v1` and are registered in
 * `./registry`.
 */

export interface TargetPolicyInput {
  mode: NutritionTargetMode;
  /** Exactly the answered `requiredProfileFields`. Frozen. */
  profile: Readonly<Partial<NutritionTargetProfileValues>>;
}

export interface TargetPolicy {
  /** Stable identifier; persisted as provenance on every target it computes. */
  readonly id: string;
  /** Increases whenever the rule changes; persisted with the id. */
  readonly version: number;
  readonly mode: NutritionTargetMode;
  /** Every profile field `compute` reads. Also what the fingerprint covers. */
  readonly requiredProfileFields: readonly NutritionTargetProfileField[];
  /**
   * The TARGET values, unrounded. Deterministic. Returns `unknown` on purpose:
   * the handler validates the result rather than trusting the policy's type.
   */
  compute(input: TargetPolicyInput): unknown;
}

/**
 * A policy's deliberate refusal: the answers are valid, but no target the
 * policy supports follows from them. Carries no detail — no value, bound or
 * reason crosses to a client.
 */
export class TargetInfeasibleError extends Error {
  constructor() {
    super("The answers do not give a supported target.");
    this.name = "TargetInfeasibleError";
  }
}

/** Resolves the policy for a mode, or `null` when none is configured. */
export interface TargetPolicyRegistry {
  get(mode: NutritionTargetMode): TargetPolicy | null;
}

export type { NutritionValues };
