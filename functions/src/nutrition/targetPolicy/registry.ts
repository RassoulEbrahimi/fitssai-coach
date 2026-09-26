import type { NutritionTargetMode } from "../../../../shared/nutrition";
import type { TargetPolicy, TargetPolicyRegistry } from "./types";

/**
 * The production target policies.
 *
 * EMPTY, deliberately. No target formula (calculated) and no manual target
 * bound (manual) has been signed off, so neither mode has a policy and the
 * deployed callable answers `TARGET_POLICY_NOT_CONFIGURED` for both. A policy
 * is added here only together with its sign-off — never a guessed default,
 * and never a test fixture (those live in `src/testing/`, which is not built
 * or deployed).
 */
export const PRODUCTION_TARGET_POLICIES: readonly TargetPolicy[] = Object.freeze([]);

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

/** The registry the deployed callable uses. Resolves nothing today. */
export const productionTargetPolicyRegistry: TargetPolicyRegistry = createTargetPolicyRegistry(PRODUCTION_TARGET_POLICIES);
