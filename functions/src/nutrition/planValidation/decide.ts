import { z } from "zod";
import {
  planValidationPolicyRefSchema,
  planValidationProvenanceSchema,
  type NutritionPlanContent,
  type PlanValidationPolicyRef,
  type PlanValidationProvenance,
  type TargetVersion,
} from "../../../../shared/nutrition";
import { NutritionPlanError } from "../errors";
import type { PlanValidationPolicy } from "./types";

/**
 * What a policy may answer. Strict, and with nothing but the outcome: a
 * policy's reasoning, and any limit it applied, is not part of the answer and
 * is never persisted.
 */
export const planValidationVerdictSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("accepted") }).strict(),
  z.object({ outcome: z.literal("rejected") }).strict(),
]);

export type PlanValidationVerdict = z.infer<typeof planValidationVerdictSchema>;

const deepFrozenCopy = <T>(value: T): T => {
  const copy = structuredClone(value);
  const freeze = (node: unknown) => {
    if (node && typeof node === "object") {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
  };
  freeze(copy);
  return copy;
};

const sameRef = (a: PlanValidationPolicyRef, b: PlanValidationPolicyRef) => a.id === b.id && a.version === b.version;

export interface PlanValidationRequest {
  /** The policy in force, or null when none is configured. */
  policy: PlanValidationPolicy | null;
  /** A candidate that has already passed the structural rules. */
  plan: NutritionPlanContent;
  target: TargetVersion;
  /**
   * An earlier acceptance of the same content for the same target (a repeat's
   * source plan). Reused only when it names exactly the policy in force; any
   * other version runs the current policy.
   */
  reusable: PlanValidationProvenance | null;
}

/**
 * The provenance to persist with a plan, or a typed refusal. Deterministic;
 * reads nothing and writes nothing.
 *
 *   no policy in force           PLAN_VALIDATION_POLICY_NOT_CONFIGURED
 *   reusable, same id + version  the reused provenance (the policy is not run)
 *   policy accepts               `{ policy: {id, version}, outcome: accepted }`
 *   policy rejects               PLAN_VALIDATION_FAILED
 *   policy throws or answers
 *   anything else                INTERNAL — its message is not kept
 */
export const decidePlanValidation = ({ policy, plan, target, reusable }: PlanValidationRequest): PlanValidationProvenance => {
  if (!policy) throw new NutritionPlanError("PLAN_VALIDATION_POLICY_NOT_CONFIGURED", "No plan-validation policy is in force.");

  const ref = planValidationPolicyRefSchema.safeParse({ id: policy.id, version: policy.version });
  if (!ref.success) throw new NutritionPlanError("INTERNAL", "The plan-validation policy is misconfigured.");

  if (reusable) {
    const reused = planValidationProvenanceSchema.safeParse(reusable);
    if (!reused.success) throw new NutritionPlanError("INTERNAL", "The reusable validation is malformed.");
    if (sameRef(reused.data.policy, ref.data)) return reused.data;
  }

  let answer: unknown;
  try {
    answer = policy.validate(deepFrozenCopy({ plan, target }));
  } catch {
    throw new NutritionPlanError("INTERNAL", "The plan-validation policy failed.");
  }
  const verdict = planValidationVerdictSchema.safeParse(answer);
  if (!verdict.success) throw new NutritionPlanError("INTERNAL", "The plan-validation policy answered something else.");
  if (verdict.data.outcome === "rejected") {
    throw new NutritionPlanError("PLAN_VALIDATION_FAILED", "The plan-validation policy did not accept the plan.");
  }
  return { policy: ref.data, outcome: "accepted" };
};
