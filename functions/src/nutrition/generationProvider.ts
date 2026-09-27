import type { NutritionGenerationInput } from "./generationInput";

/**
 * The seam a Nutrition plan generator plugs into (NUT-11).
 *
 * UNCONFIGURED in production: no generator, no model, no prompt and no secret
 * is deployed, so `nutritionRequestPlan` answers
 * `GENERATION_PROVIDER_NOT_CONFIGURED` before it reads or writes anything. The
 * lifecycle behind this seam is exercised by a deterministic test generator
 * that lives in `src/testing/`, which the Functions build excludes.
 *
 * A generator returns `unknown`: it is an untrusted source, and its answer is
 * parsed by the shared plan-content schema, checked against the input and
 * validated by the plan-validation policy before anything is persisted. It
 * proposes plan CONTENT only — never a plan id, a request id, a target, a
 * validation, a source, a lifecycle or a timestamp; those are the server's.
 */

/**
 * Why a candidate was not accepted, as a repair is told it. Normalised:
 * structural issues as path and message, a policy refusal as its kind alone.
 * Never a profile value, a Firestore path, an exception or a secret.
 */
export type NutritionCandidateFailure =
  /** Not plan content by the shared schema and its structural rules. */
  | { kind: "invalidContent"; issues: Array<{ path: string; message: string }> }
  /** Plan content, but not for the dates and slots that were asked for. */
  | { kind: "inputMismatch"; issues: Array<{ path: string; message: string }> }
  /** Structurally valid, and not accepted by the plan-validation policy. */
  | { kind: "rejectedByPolicy" };

export interface NutritionPlanRepairRequest {
  /** The same minimized input the first attempt had. */
  input: NutritionGenerationInput;
  failure: NutritionCandidateFailure;
}

export interface NutritionPlanProvider {
  /** Identifies the implementation. Never a key or an endpoint. */
  readonly id: string;
  /** Raw, unvalidated plan content for `input`. */
  generate(input: NutritionGenerationInput): Promise<unknown>;
  /**
   * The one repair attempt after an unaccepted first answer. Optional: without
   * it, the first answer is final.
   */
  repair?(request: NutritionPlanRepairRequest): Promise<unknown>;
}

/** A configured generator, with the operational setting it needs. */
export interface NutritionGenerationSetup {
  provider: NutritionPlanProvider;
  /**
   * How long a claim on a request stays its invocation's business — the
   * deployment's execution budget plus a margin. Operational, never shown to
   * a person; it is decided together with the deployment that runs the
   * generator, not here.
   */
  operationLeaseMs: number;
}

/** Resolves the generator in force, or null when none is configured. */
export interface NutritionGenerationProviderRegistry {
  current(): NutritionGenerationSetup | null;
}

/** The deployed registry. Resolves nothing: there is no production Nutrition generator. */
export const productionNutritionGenerationProviderRegistry: NutritionGenerationProviderRegistry = Object.freeze({
  current: () => null,
});
