import type { PlanValidationPolicy, PlanValidationPolicyRegistry } from "./types";

/**
 * The production plan-validation policies.
 *
 * EMPTY, deliberately. No plan tolerance — how far a plan may be from its
 * target, what a meal or a day may contain — has been signed off, so no plan
 * can be validated and every activation that needs a policy answers
 * `PLAN_VALIDATION_POLICY_NOT_CONFIGURED`. A policy is added here only together
 * with its sign-off — never a guessed default, and never a test fixture (those
 * live in `src/testing/`, which is not built or deployed).
 */
export const PRODUCTION_PLAN_VALIDATION_POLICIES: readonly PlanValidationPolicy[] = Object.freeze([]);

/**
 * A registry over `policies`: at most one policy is in force at a time. Throws
 * on a second one rather than letting list order decide which one runs.
 */
export const createPlanValidationPolicyRegistry = (
  policies: readonly PlanValidationPolicy[]
): PlanValidationPolicyRegistry => {
  if (policies.length > 1) throw new Error("more than one plan-validation policy is in force");
  const policy = policies[0] ?? null;
  return { current: () => policy };
};

/** The registry the deployed callables use. Resolves nothing today. */
export const productionPlanValidationPolicyRegistry: PlanValidationPolicyRegistry = createPlanValidationPolicyRegistry(
  PRODUCTION_PLAN_VALIDATION_POLICIES
);
