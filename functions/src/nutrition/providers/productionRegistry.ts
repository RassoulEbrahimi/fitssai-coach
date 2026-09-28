import { z } from "zod";
import {
  NutritionGenerationProviderConfigurationError,
  type NutritionGenerationProviderRegistry,
  type NutritionGenerationSetup,
} from "../generationProvider";
import {
  createNutritionVertexProvider,
  nutritionVertexProviderConfigurationSchema,
  type NutritionVertexProviderConfiguration,
  type NutritionVertexProviderDependencies,
} from "./vertexGemini";

/**
 * The deployed Nutrition generator registry (NUT-12B): lazy, and — since
 * NUT-12C.2 — configured with the signed Vertex deployment below.
 *
 * `nutritionRequestPlan` asks it only for new work, and only after the
 * backend gate `NUTRITION_AI_PRODUCTION_ENABLED` has let that work through —
 * which it does not. Replaying or answering an existing request never asks it,
 * so no Vertex client is built and no project, location or credential is
 * looked up for one.
 *
 * Asked, it answers:
 *
 *   no deployment configuration        null → GENERATION_PROVIDER_NOT_CONFIGURED
 *   an incomplete one                   a configuration error →
 *                                       GENERATION_PROVIDER_NOT_CONFIGURED;
 *                                       never a defaulted project, location or
 *                                       setting
 *   a complete one                      the Vertex generator and its lease;
 *                                       the SDK client is built on its first call
 *
 * "AI disabled" is the gate's answer, never this registry's.
 */

/** A deployment of the Vertex generator: the adapter's configuration and the claim lease that covers its calls. */
export interface NutritionVertexDeployment {
  provider: NutritionVertexProviderConfiguration;
  /** The claim lease; decided with the Function's execution budget, never here. */
  operationLeaseMs: number;
}

const deploymentSchema = z
  .object({
    provider: nutritionVertexProviderConfigurationSchema,
    operationLeaseMs: z.number().int().positive(),
  })
  .strict();

/**
 * The signed technical deployment (NUT-12C.2). The model is not here: it is
 * the adapter's own pin, `NUTRITION_GEMINI_MODEL_ID`, and moves only there.
 *
 *   project               fitssai-coach
 *   location              eu
 *   thinkingLevel         LOW — the pinned model has no MINIMAL
 *   maxOutputTokens       8192
 *   timeoutMs             45 s per attempt; a timeout is not retried
 *   maxTransportAttempts  2 in total, for 429/5xx only
 *   operationLeaseMs      300 s
 *
 * The budget these fit, worst case: a first call and one repair, each at most
 * two 45-second attempts with the transport's back-off between them —
 * 2 × (2 × 45 s + 0.25 s) = 180.5 s — inside the Function's 240-second
 * timeout (`nutritionRequestPlan` in src/index.ts), inside the 300-second lease, which
 * the browser's own timeout (`NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS`)
 * matches. A claim therefore outlives the invocation that holds it, and a
 * takeover can only start once that invocation cannot still be running.
 *
 * Configured is not enabled: `NUTRITION_AI_PRODUCTION_ENABLED` is off, so no
 * new work reaches this registry and no production call is made. Vertex
 * authenticates as the Function's runtime identity (Application Default
 * Credentials) — no key, no secret. That identity's permission to call Vertex
 * AI predictions is a deployment prerequisite outside this repository, and so
 * is the privacy, legal and data-processing sign-off; both are open until
 * NUT-14 enables production.
 */
export const PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT: NutritionVertexDeployment = Object.freeze({
  provider: Object.freeze({
    project: "fitssai-coach",
    location: "eu",
    maxOutputTokens: 8192,
    thinkingLevel: "LOW",
    timeoutMs: 45_000,
    maxTransportAttempts: 2,
  }),
  operationLeaseMs: 300_000,
});

/** A lazy registry over `deployment`: nothing is checked or built until it is asked, and the answer is kept. */
export const createNutritionVertexProviderRegistry = (
  deployment: unknown,
  dependencies: NutritionVertexProviderDependencies = {}
): NutritionGenerationProviderRegistry => {
  let resolved: NutritionGenerationSetup | null | undefined;
  return Object.freeze({
    current: (): NutritionGenerationSetup | null => {
      if (resolved !== undefined) return resolved;
      if (deployment === null || deployment === undefined) return (resolved = null);
      const parsed = deploymentSchema.safeParse(deployment);
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(deployment)"))];
        throw new NutritionGenerationProviderConfigurationError(`invalid ${fields.join(", ")}`);
      }
      resolved = Object.freeze({
        provider: createNutritionVertexProvider(parsed.data.provider, dependencies),
        operationLeaseMs: parsed.data.operationLeaseMs,
      });
      return resolved;
    },
  });
};

/**
 * The registry the deployed callable is wired to, over the signed deployment.
 * Lazy: creating it checks and builds nothing, and resolving it builds the
 * adapter but no SDK client — that happens on the first generation call,
 * which the closed gate never lets through.
 */
export const productionNutritionGenerationProviderRegistry: NutritionGenerationProviderRegistry =
  createNutritionVertexProviderRegistry(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT);
