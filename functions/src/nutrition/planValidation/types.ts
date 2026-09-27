import type { NutritionPlanContent, TargetVersion } from "../../../../shared/nutrition";

/**
 * The seam every persisted Nutrition V2 plan goes through.
 *
 * A plan-validation policy is the versioned, signed-off rule that decides
 * whether a structurally valid plan may be persisted for a target. It is not
 * the structural check — that is the shared schema, and a plan that fails it
 * never reaches a policy — and it is not a target policy, which computes the
 * target itself.
 *
 * A policy is a pure function of its input. It has no Firestore, no auth, no
 * clock, no provider and no randomness, and it does not mutate its input (it
 * receives a deep-frozen copy). Its answer is validated before anything is
 * persisted; a policy that throws or answers something else is an internal
 * failure, and its message never reaches a client.
 *
 * No policy is registered in production (`./registry`): no plan tolerance has
 * been signed off.
 */

export interface PlanValidationInput {
  /** The structurally valid candidate: its dates, slots and planned meals. Deep-frozen. */
  plan: NutritionPlanContent;
  /** The target version the plan is for. Deep-frozen. */
  target: TargetVersion;
}

export interface PlanValidationPolicy {
  /** Stable identifier; persisted as provenance on every plan it accepts. */
  readonly id: string;
  /** Increases whenever the rule changes; persisted with the id. */
  readonly version: number;
  /**
   * `{ outcome: "accepted" }` or `{ outcome: "rejected" }`. Deterministic.
   * Returns `unknown` on purpose: the caller validates the answer rather than
   * trusting the policy's type.
   */
  validate(input: PlanValidationInput): unknown;
}

/** Resolves the plan-validation policy in force, or `null` when none is configured. */
export interface PlanValidationPolicyRegistry {
  current(): PlanValidationPolicy | null;
}
