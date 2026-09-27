import {
  nutritionPlanContentSchema,
  type NutritionGenerationFailureCode,
  type NutritionPlanContent,
  type PlanValidationProvenance,
  type TargetVersion,
} from "../../../shared/nutrition";
import { isNutritionPlanError } from "./errors";
import type { NutritionGenerationInput } from "./generationInput";
import {
  NutritionProviderAnswerRejection,
  type NutritionCandidateFailure,
  type NutritionPlanProvider,
} from "./generationProvider";
import { decidePlanValidation } from "./planValidation/decide";
import type { PlanValidationPolicy } from "./planValidation/types";

/**
 * From a generator's answer to an accepted plan candidate, or a stable
 * failure (NUT-11). Nothing here reads or writes Firestore, and nothing is
 * kept: not the input, not the answer, not a message.
 *
 * Each answer is judged in a fixed order — structure fails before policy:
 *
 *   0. a reply the generator's own transport contract refused (NUT-12B) is
 *      invalid content, with the generator's normalised issues
 *   1. the shared plan-content schema: strict fields and the structural
 *      rules (seven contiguous dates, one meal per configured slot, …)
 *   2. the dates and slots that were asked for
 *   3. the plan-validation policy in force, for the captured target
 *
 * An answer that fails any step gets at most ONE repair attempt, told what
 * failed in normalised form. There is no loop: a second failure is final.
 */

export type NutritionCandidateOutcome =
  | { ok: true; content: NutritionPlanContent; validation: PlanValidationProvenance; repairUsed: boolean }
  | { ok: false; code: NutritionGenerationFailureCode; repairUsed: boolean };

/** Enough for a repair to act on; a candidate's issue list is not unbounded. */
const MAX_REPAIR_ISSUES = 20;

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

type Judgement =
  | { ok: true; content: NutritionPlanContent; validation: PlanValidationProvenance }
  | { ok: false; failure: NutritionCandidateFailure }
  /** The policy itself failed: not the candidate's fault, and not repairable. */
  | { ok: false; internal: true };

const judge = (
  answer: unknown,
  input: NutritionGenerationInput,
  policy: PlanValidationPolicy | null,
  target: TargetVersion
): Judgement => {
  // 0. A reply that was not even the generator's requested shape.
  if (answer instanceof NutritionProviderAnswerRejection) {
    return {
      ok: false,
      failure: {
        kind: "invalidContent",
        issues: answer.issues.slice(0, MAX_REPAIR_ISSUES).map(({ path, message }) => ({ path, message })),
      },
    };
  }

  // 1. Structure.
  const parsed = nutritionPlanContentSchema.safeParse(answer);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        kind: "invalidContent",
        issues: parsed.error.issues.slice(0, MAX_REPAIR_ISSUES).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }
  const content = parsed.data;

  // 2. The week and the slots that were asked for, exactly.
  const mismatches: Array<{ path: string; message: string }> = [];
  if (content.startDate !== input.startDate) mismatches.push({ path: "startDate", message: `must be ${input.startDate}` });
  if (content.slotOrder.join(",") !== input.slotOrder.join(",")) {
    mismatches.push({ path: "slotOrder", message: `must be ${input.slotOrder.join(", ")}` });
  }
  if (mismatches.length > 0) return { ok: false, failure: { kind: "inputMismatch", issues: mismatches } };

  // 3. Policy. Structurally valid is not accepted.
  try {
    const validation = decidePlanValidation({ policy, plan: content, target, reusable: null });
    return { ok: true, content, validation };
  } catch (error) {
    if (isNutritionPlanError(error) && error.code === "PLAN_VALIDATION_FAILED") {
      return { ok: false, failure: { kind: "rejectedByPolicy" } };
    }
    return { ok: false, internal: true };
  }
};

const failureCode = (failure: NutritionCandidateFailure): NutritionGenerationFailureCode =>
  failure.kind === "rejectedByPolicy" ? "PLAN_VALIDATION_FAILED" : "CANDIDATE_INVALID";

/**
 * Ask the generator, judge the answer, and repair at most once. A generator
 * that throws is `PROVIDER_FAILED`; its error is not kept.
 */
export const generateNutritionPlanCandidate = async ({
  provider,
  input,
  policy,
  target,
}: {
  provider: NutritionPlanProvider;
  input: NutritionGenerationInput;
  policy: PlanValidationPolicy | null;
  target: TargetVersion;
}): Promise<NutritionCandidateOutcome> => {
  let answer: unknown;
  try {
    answer = await provider.generate(deepFrozenCopy(input));
  } catch {
    return { ok: false, code: "PROVIDER_FAILED", repairUsed: false };
  }

  const first = judge(answer, input, policy, target);
  if (first.ok) return { ...first, repairUsed: false };
  if ("internal" in first) return { ok: false, code: "INTERNAL", repairUsed: false };
  if (!provider.repair) return { ok: false, code: failureCode(first.failure), repairUsed: false };

  // The one repair attempt.
  try {
    answer = await provider.repair(deepFrozenCopy({ input, failure: first.failure }));
  } catch {
    return { ok: false, code: "PROVIDER_FAILED", repairUsed: true };
  }
  const second = judge(answer, input, policy, target);
  if (second.ok) return { ...second, repairUsed: true };
  if ("internal" in second) return { ok: false, code: "INTERNAL", repairUsed: true };
  return { ok: false, code: failureCode(second.failure), repairUsed: true };
};
