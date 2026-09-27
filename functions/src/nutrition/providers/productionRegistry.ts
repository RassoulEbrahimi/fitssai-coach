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
 * The deployed Nutrition generator registry (NUT-12B): lazy, and unconfigured.
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
 * No deployment is signed off: the Vertex project, the location, data
 * processing and every operational value wait for NUT-12C. Null, so nothing
 * can be generated even with the gate on.
 */
export const PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT: NutritionVertexDeployment | null = null;

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

/** The registry the deployed callable is wired to. Resolves nothing: there is no deployment. */
export const productionNutritionGenerationProviderRegistry: NutritionGenerationProviderRegistry =
  createNutritionVertexProviderRegistry(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT);
