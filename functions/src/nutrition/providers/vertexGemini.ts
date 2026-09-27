import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createGoogleGenAiClient,
  defaultSleep,
  extractGenAiText,
  genAiErrorStatus,
  parseGenAiJson,
  runWithTransportRetry,
  type GoogleGenAiClient,
  type GoogleGenAiConnection,
} from "../../ai/googleGenai";
import { nutritionGenerationInputSchema, type NutritionGenerationInput } from "../generationInput";
import {
  NutritionGenerationProviderConfigurationError,
  NutritionProviderAnswerRejection,
  type NutritionPlanProvider,
} from "../generationProvider";
import { NUTRITION_PLAN_SYSTEM_INSTRUCTION, buildNutritionPlanPrompt, buildNutritionRepairPrompt } from "./prompt";
import { interpretNutritionProviderReply, nutritionProviderResponseJsonSchema } from "./responseContract";

/**
 * The Nutrition plan generator on Google Vertex AI (NUT-12B).
 *
 * Authentication is the runtime's own IAM identity through Application
 * Default Credentials: there is no Nutrition API key, no secret and nothing a
 * browser could hold. The project and the location are explicit
 * configuration; neither has a default here, and which ones production uses
 * is not decided (NUT-12C).
 *
 * The adapter asks the model for meal content only (`./responseContract`),
 * assembles canonical plan content on the server — dates, slot order and meal
 * ids are the server's — and hands it to the NUT-11 candidate step, which
 * judges it by the shared schema and the plan-validation policy. A reply that
 * is not the requested shape comes back as a `NutritionProviderAnswerRejection`
 * and takes the existing one-repair path.
 *
 * Nothing here persists or logs anything, and nothing of a provider failure
 * leaves this file but a fixed message: the NUT-11 step records it as
 * `PROVIDER_FAILED`.
 *
 * NOT IN USE: the backend gate `NUTRITION_AI_PRODUCTION_ENABLED` is off and
 * the production deployment configuration is absent, so no production call
 * can reach this adapter.
 */

/**
 * Nutrition's model, independent of Training's `GEMINI_MODEL_ID`: moving
 * either never moves the other.
 *
 * Availability checked on 2026-09-27. A migration is this one line plus the
 * test that pins it.
 */
export const NUTRITION_GEMINI_MODEL_ID = "gemini-3.8-flash";

/** Identifies the implementation. Never a key, a project, a location or an endpoint. */
export const NUTRITION_VERTEX_PROVIDER_ID = "google-vertex-nutrition";

/*
 * What the pinned model can accept. These are capability limits of
 * `gemini-3.8-flash` and the generation-config contract — never Nutrition
 * policy, and never the production values, which a deployment chooses inside
 * them. A setting outside them is a configuration error before any client is
 * built, not a paid request that fails. A model migration revisits both.
 *
 * The pinned model takes reasoning control through the thinking level only:
 * custom sampling parameters, a candidate count and repetition penalties are
 * not part of Nutrition's request, and none is a deployment setting. A future
 * model that supports them reintroduces them explicitly, with the migration.
 */

/**
 * The thinking levels the pinned model supports (it has no MINIMAL). A
 * configuration may also name none (null): no thinking setting is sent and the
 * model uses its default.
 */
export const NUTRITION_THINKING_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

/** The pinned model's maximum output tokens: the ceiling, not the configured value. */
export const NUTRITION_GEMINI_MAX_OUTPUT_TOKENS = 65_536;

/**
 * A structural ceiling on transport attempts, whatever a configuration asks:
 * retries stay bounded. Not the production value, which a configuration names.
 */
export const NUTRITION_MAX_TRANSPORT_ATTEMPTS_CEILING = 3;

const nonBlank = z.string().trim().min(1).regex(/^\S+$/);

/**
 * Everything the adapter runs with. Every field is required: an operational
 * value — output cap, thinking level, timeout, attempts — is a signed-off
 * decision of the deployment, never a default of this file. Strict: a stale
 * deployment still carrying a sampling setting the pinned model does not take
 * is refused, never silently ignored.
 */
export const nutritionVertexProviderConfigurationSchema = z
  .object({
    /** The Vertex AI project. */
    project: nonBlank,
    /** The Vertex AI location. No default: which one is signed off is NUT-12C's. */
    location: nonBlank,
    /** In [1, the model's ceiling]. */
    maxOutputTokens: z.number().int().min(1).max(NUTRITION_GEMINI_MAX_OUTPUT_TOKENS),
    /** One of the model's levels, or null to send none. */
    thinkingLevel: z.enum(NUTRITION_THINKING_LEVELS).nullable(),
    /** One attempt's budget, in ms. A timeout is not retried. */
    timeoutMs: z.number().int().positive(),
    /** Attempts in total for 429/5xx, including the first. */
    maxTransportAttempts: z.number().int().min(1).max(NUTRITION_MAX_TRANSPORT_ATTEMPTS_CEILING),
  })
  .strict();

export type NutritionVertexProviderConfiguration = z.infer<typeof nutritionVertexProviderConfigurationSchema>;

/**
 * The configuration, checked and frozen — or a configuration error that names
 * the fields at fault and none of their values.
 */
export const parseNutritionVertexProviderConfiguration = (value: unknown): NutritionVertexProviderConfiguration => {
  const parsed = nutritionVertexProviderConfigurationSchema.safeParse(value);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "(configuration)")))];
    throw new NutritionGenerationProviderConfigurationError(`invalid ${fields.join(", ")}`);
  }
  return Object.freeze(parsed.data);
};

type VertexConnection = Extract<GoogleGenAiConnection, { kind: "vertex" }>;

export interface NutritionVertexProviderDependencies {
  /** Builds the SDK client, once, on the first call. Tests inject a fake; production builds the real one. */
  createClient?: (connection: VertexConnection) => GoogleGenAiClient;
  sleep?: (ms: number) => Promise<void>;
  /** Mints each meal id. Server-side; never a meal name. */
  newMealId?: () => string;
}

/** Why a call produced no reply, as a category. Never the provider's own message. */
export type NutritionProviderFailureReason = "rateLimited" | "unavailable" | "refused" | "timeout" | "failed" | "invalidInput";

/**
 * A call that produced no reply. Its message is fixed: no status text, no
 * endpoint, project, location, credential, prompt, request or response.
 */
export class NutritionProviderCallError extends Error {
  constructor(readonly reason: NutritionProviderFailureReason) {
    super("The Nutrition provider call failed.");
    this.name = "NutritionProviderCallError";
  }
}

/** An attempt that ran out of its budget. Carries no status, so it is never retried. */
class NutritionProviderTimeout extends Error {
  constructor() {
    super("The Nutrition provider call timed out.");
    this.name = "NutritionProviderTimeout";
  }
}

const reasonFor = (error: unknown): NutritionProviderFailureReason => {
  if (error instanceof NutritionProviderTimeout) return "timeout";
  const status = error === null || error === undefined ? undefined : genAiErrorStatus(error);
  if (status === 429) return "rateLimited";
  if (status !== undefined && status >= 500) return "unavailable";
  if (status !== undefined) return "refused";
  return "failed";
};

/** Run one attempt within `timeoutMs`; on timeout the request is aborted client-side and the attempt fails. */
const withinTimeout = <T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new NutritionProviderTimeout());
    }, timeoutMs);
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export const createNutritionVertexProvider = (
  configuration: unknown,
  dependencies: NutritionVertexProviderDependencies = {}
): NutritionPlanProvider => {
  const config = parseNutritionVertexProviderConfiguration(configuration);
  const createClient = dependencies.createClient ?? ((connection: VertexConnection) => createGoogleGenAiClient(connection));
  const sleep = dependencies.sleep ?? defaultSleep;
  const newMealId = dependencies.newMealId ?? randomUUID;

  // Built on the first call, not before: a registry that only answers
  // "configured" constructs nothing and looks up no credential.
  let client: GoogleGenAiClient | null = null;
  const clientFor = (): GoogleGenAiClient =>
    (client ??= createClient({ kind: "vertex", project: config.project, location: config.location }));

  const ask = async (input: NutritionGenerationInput, prompt: (minimized: NutritionGenerationInput) => string): Promise<unknown> => {
    // The minimized input, re-checked strictly: nothing else can reach the prompt.
    const minimized = nutritionGenerationInputSchema.safeParse(input);
    if (!minimized.success) throw new NutritionProviderCallError("invalidInput");
    const contents = prompt(minimized.data);
    const responseJsonSchema = nutritionProviderResponseJsonSchema(minimized.data.slotOrder);

    const outcome = await runWithTransportRetry(
      () =>
        withinTimeout(
          (signal) =>
            clientFor().models.generateContent({
              model: NUTRITION_GEMINI_MODEL_ID,
              contents,
              config: {
                systemInstruction: NUTRITION_PLAN_SYSTEM_INSTRUCTION,
                maxOutputTokens: config.maxOutputTokens,
                ...(config.thinkingLevel === null ? {} : { thinkingConfig: { thinkingLevel: config.thinkingLevel } }),
                responseMimeType: "application/json",
                responseJsonSchema,
                abortSignal: signal,
              },
            }),
          config.timeoutMs
        ),
      { maxAttempts: config.maxTransportAttempts, sleep }
    );
    if (!outcome.ok) throw new NutritionProviderCallError(reasonFor(outcome.error));

    const text = outcome.value === null || outcome.value === undefined ? undefined : extractGenAiText(outcome.value);
    const reply = text === undefined ? undefined : parseGenAiJson(text);
    const interpreted = interpretNutritionProviderReply({ input: minimized.data, reply, newMealId });
    return interpreted.ok ? interpreted.content : new NutritionProviderAnswerRejection(interpreted.issues);
  };

  return Object.freeze({
    id: NUTRITION_VERTEX_PROVIDER_ID,
    generate: (input: NutritionGenerationInput) => ask(input, buildNutritionPlanPrompt),
    repair: ({ input, failure }: { input: NutritionGenerationInput; failure: Parameters<typeof buildNutritionRepairPrompt>[1] }) =>
      ask(input, (minimized) => buildNutritionRepairPrompt(minimized, failure)),
  });
};
