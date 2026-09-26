import { createTargetPolicyRegistry } from "../nutrition/targetPolicy/registry";
import type { TargetPolicy, TargetPolicyRegistry } from "../nutrition/targetPolicy/types";

/**
 * TEST FIXTURES ONLY — not target formulas.
 *
 * These policies exist so the target plumbing (eligibility, required fields,
 * validation, fingerprinting, versioning, idempotency, atomicity) can be
 * exercised end to end while production has no policy at all. Their numbers
 * are arbitrary and deliberately meaningless: they are not FitssAI nutrition
 * recommendations, they resemble no published equation, and nothing outside
 * tests may use them.
 *
 * `src/testing/` is excluded from the Functions build, so this file is never
 * compiled into `lib/` or deployed, and a boundary test proves no production
 * module imports it.
 */

/** Fixture arithmetic: a sum of the inputs plus fixed fixture macros. */
export const FIXTURE_CALCULATED_POLICY = Object.freeze<TargetPolicy>({
  id: "test-fixture-calculated",
  version: 1,
  mode: "calculated" as const,
  requiredProfileFields: Object.freeze(["weight", "height", "biologicalSex", "activityLevel", "fitnessGoal"] as const),
  compute: ({ profile }) => ({
    kcal: 1000.5 + (profile.weight ?? 0) + (profile.height ?? 0),
    proteinG: 11.25,
    carbsG: 22.5,
    fatG: 33.75,
  }),
});

/** Echoes the stored manual kcal with fixed fixture macros. No bounds: bounds are unsigned. */
export const FIXTURE_MANUAL_POLICY = Object.freeze<TargetPolicy>({
  id: "test-fixture-manual",
  version: 1,
  mode: "manual" as const,
  requiredProfileFields: Object.freeze(["manualTargetKcal"] as const),
  compute: ({ profile }) => ({
    kcal: profile.manualTargetKcal,
    proteinG: 1.5,
    carbsG: 2.5,
    fatG: 3.5,
  }),
});

export const fixtureTargetPolicyRegistry = (
  policies: readonly TargetPolicy[] = [FIXTURE_CALCULATED_POLICY, FIXTURE_MANUAL_POLICY]
): TargetPolicyRegistry => createTargetPolicyRegistry(policies);
