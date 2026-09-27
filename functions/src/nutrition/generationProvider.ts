import type { NutritionGenerationInput } from "./generationInput";

/**
 * The seam a Nutrition plan generator plugs into (NUT-11, NUT-12B).
 *
 * A generator returns `unknown`: it is an untrusted source, and its answer is
 * parsed by the shared plan-content schema, checked against the input and
 * validated by the plan-validation policy before anything is persisted. It
 * proposes plan CONTENT only — never a plan id, a request id, a target, a
 * validation, a source, a lifecycle or a timestamp; those are the server's.
 *
 * NUT-12B adds the Vertex AI generator (`providers/vertexGemini.ts`) and its
 * lazy production registry (`providers/productionRegistry.ts`). Neither makes
 * generation usable: the backend gate `NUTRITION_AI_PRODUCTION_ENABLED`
 * (`aiGate.ts`) is off, and it is checked before the registry is ever asked.
 * The lifecycle behind this seam is exercised by a deterministic test
 * generator in `src/testing/`, which the Functions build excludes.
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

/**
 * A generator's answer that the generator's own transport contract already
 * refused, before any plan content was assembled from it (NUT-12B): the
 * model's reply was not the requested shape. The candidate step treats it as
 * invalid content — the one repair is told these issues — exactly as it treats
 * plan content that fails the shared schema.
 *
 * A class instance, so a model's JSON can never pose as one; its issues are
 * normalised paths and messages, never the model's text.
 */
export class NutritionProviderAnswerRejection {
  readonly issues: ReadonlyArray<Readonly<{ path: string; message: string }>>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    this.issues = Object.freeze(issues.map(({ path, message }) => Object.freeze({ path, message })));
    Object.freeze(this);
  }
}

export interface NutritionPlanProvider {
  /** Identifies the implementation. Never a key or an endpoint. */
  readonly id: string;
  /** Raw, unvalidated plan content for `input`, or a rejection of the model's reply. */
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

/**
 * Resolves the generator in force, or null when none is configured. It may
 * throw `NutritionGenerationProviderConfigurationError` when a configuration
 * exists and is not complete — never a silently defaulted generator.
 */
export interface NutritionGenerationProviderRegistry {
  current(): NutritionGenerationSetup | null;
}

/**
 * A generator configuration that exists and cannot be used: a missing
 * project or location, an unusable setting. Distinct from "no generator" and
 * from "AI disabled"; it carries no configuration value.
 */
export class NutritionGenerationProviderConfigurationError extends Error {
  constructor(detail: string) {
    super(`The Nutrition generation provider is misconfigured: ${detail}`);
    this.name = "NutritionGenerationProviderConfigurationError";
  }
}
