import type { PlanValidationPolicy, PlanValidationPolicyRegistry } from "./types";
import { TARGET_ALIGNMENT_POLICY_V1 } from "./v1";

/**
 * The production plan-validation policy: exactly one, signed off.
 *
 *   `target-alignment` v1 — a plan's days and its seven-day average against
 *   its captured target (see `./v1`)
 *
 * A policy is added or replaced here only together with its sign-off — never
 * a guessed default, and never a test fixture (those live in `src/testing/`,
 * which is not built or deployed). A changed rule is a new version, so a
 * stored acceptance is reused only under the version that made it.
 */
export const PRODUCTION_PLAN_VALIDATION_POLICIES: readonly PlanValidationPolicy[] = Object.freeze([TARGET_ALIGNMENT_POLICY_V1]);

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

/** The registry the deployed callables use. */
export const productionPlanValidationPolicyRegistry: PlanValidationPolicyRegistry = createPlanValidationPolicyRegistry(
  PRODUCTION_PLAN_VALIDATION_POLICIES
);
