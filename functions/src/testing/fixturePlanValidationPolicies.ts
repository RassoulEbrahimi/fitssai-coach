import { createPlanValidationPolicyRegistry } from "../nutrition/planValidation/registry";
import type {
  PlanValidationInput,
  PlanValidationPolicy,
  PlanValidationPolicyRegistry,
} from "../nutrition/planValidation/types";

/**
 * TEST FIXTURES ONLY — not plan-validation rules.
 *
 * These policies exist so the plan plumbing (structure first, provenance,
 * reuse by version, refusal, atomic activation) can be exercised end to end
 * while production has no policy at all. They look at no nutrient and apply
 * no limit: they accept or reject unconditionally, or by a fixture meal name.
 * Nothing here is a FitssAI nutrition rule, and nothing outside tests may use
 * them.
 *
 * `src/testing/` is excluded from the Functions build, so this file is never
 * compiled into `lib/` or deployed, and a boundary test proves no production
 * module imports it.
 */

/** Accepts every plan it is shown. */
export const FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY = Object.freeze<PlanValidationPolicy>({
  id: "test-fixture-accept",
  version: 1,
  validate: () => ({ outcome: "accepted" }),
});

/** The same fixture, as a later version: its acceptances are not the version-1 acceptances. */
export const FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY_V2 = Object.freeze<PlanValidationPolicy>({
  id: "test-fixture-accept",
  version: 2,
  validate: () => ({ outcome: "accepted" }),
});

/** Rejects every plan it is shown. */
export const FIXTURE_REJECT_PLAN_VALIDATION_POLICY = Object.freeze<PlanValidationPolicy>({
  id: "test-fixture-reject",
  version: 1,
  validate: () => ({ outcome: "rejected" }),
});

/** A fixture meal name that `FIXTURE_NAME_PLAN_VALIDATION_POLICY` rejects. Not a food rule. */
export const FIXTURE_REJECTED_MEAL_NAME = "fixture-rejected-meal";

/** Rejects a plan containing the fixture meal name; accepts anything else. */
export const FIXTURE_NAME_PLAN_VALIDATION_POLICY = Object.freeze<PlanValidationPolicy>({
  id: "test-fixture-name",
  version: 1,
  validate: ({ plan }: PlanValidationInput) =>
    plan.days.some((day) => day.meals.some((meal) => meal.name === FIXTURE_REJECTED_MEAL_NAME))
      ? { outcome: "rejected" }
      : { outcome: "accepted" },
});

export const fixturePlanValidationPolicyRegistry = (
  policies: readonly PlanValidationPolicy[] = [FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY]
): PlanValidationPolicyRegistry => createPlanValidationPolicyRegistry(policies);
