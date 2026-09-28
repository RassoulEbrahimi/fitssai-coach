import type { NutritionTargetMode } from "../../../../shared/nutrition";
import type { TargetPolicy, TargetPolicyRegistry } from "./types";
import { CALCULATED_TARGET_POLICY_V1, MANUAL_TARGET_POLICY_V1 } from "./v1";

/**
 * The production target policies: exactly one per mode, each signed off.
 *
 *   calculated  `calculated-target` v1
 *   manual      `manual-target` v1
 *
 * A policy is added or replaced here only together with its sign-off — never
 * a guessed default, and never a test fixture (those live in `src/testing/`,
 * which is not built or deployed). A changed rule is a new version, so every
 * stored target keeps naming the rule that computed it.
 */
export const PRODUCTION_TARGET_POLICIES: readonly TargetPolicy[] = Object.freeze([
  CALCULATED_TARGET_POLICY_V1,
  MANUAL_TARGET_POLICY_V1,
]);

/**
 * A registry over `policies`, one per mode. Throws on a second policy for the
 * same mode rather than letting list order decide which one runs.
 */
export const createTargetPolicyRegistry = (policies: readonly TargetPolicy[]): TargetPolicyRegistry => {
  const byMode = new Map<NutritionTargetMode, TargetPolicy>();
  for (const policy of policies) {
    if (byMode.has(policy.mode)) throw new Error(`more than one target policy for mode ${policy.mode}`);
    byMode.set(policy.mode, policy);
  }
  return { get: (mode) => byMode.get(mode) ?? null };
};

/** The registry the deployed callable uses. */
export const productionTargetPolicyRegistry: TargetPolicyRegistry = createTargetPolicyRegistry(PRODUCTION_TARGET_POLICIES);
