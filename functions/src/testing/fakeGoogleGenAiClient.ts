import type { NutritionSlotId } from "../../../shared/nutrition";
import type { GoogleGenAiClient } from "../ai/googleGenai";
import type { NutritionVertexDeployment } from "../nutrition/providers/productionRegistry";
import type { NutritionVertexProviderConfiguration } from "../nutrition/providers/vertexGemini";

/**
 * TEST FIXTURES ONLY — a scripted stand-in for the Google GenAI SDK client.
 *
 * It makes no network call and holds no credential: every answer is a scripted
 * step. `src/testing/` is excluded from the Functions build, so this file is
 * never compiled into `lib/` or deployed.
 */

/**
 * One scripted answer:
 *
 *   { reply }    the model's text is `JSON.stringify(reply)`
 *   { text }     the model's text, verbatim
 *   { status }   the call fails with that HTTP status (and a secret-looking message)
 *   "empty"      a response with no text at all
 *   "hang"       the call never settles, unless aborted
 */
export type FakeGenAiStep = { reply: unknown } | { text: string } | { status: number } | "empty" | "hang";

export interface FakeGoogleGenAiClient extends GoogleGenAiClient {
  /** What each call was asked, minus its abort signal. */
  readonly requests: Array<Record<string, unknown>>;
  /** The abort signal each call carried. */
  readonly signals: AbortSignal[];
}

/** A leaked-looking failure message: the adapter must never pass it on. */
export const FAKE_PROVIDER_FAILURE_MESSAGE =
  "quota project fixture-project-123 exceeded at https://fixture-location-aiplatform.example/v1 token=ya29.fixture-secret";

export const createFakeGoogleGenAiClient = (steps: FakeGenAiStep[]): FakeGoogleGenAiClient => {
  const requests: Array<Record<string, unknown>> = [];
  const signals: AbortSignal[] = [];
  let index = 0;
  return {
    requests,
    signals,
    models: {
      generateContent: async (request) => {
        const { config, ...rest } = request as { config?: Record<string, unknown> };
        const { abortSignal, ...configRest } = config ?? {};
        if (abortSignal) signals.push(abortSignal as AbortSignal);
        requests.push(structuredClone({ ...rest, config: configRest }));
        const step = steps[Math.min(index, steps.length - 1)];
        index += 1;
        if (step === "hang") {
          return new Promise((_resolve, reject) => {
            (abortSignal as AbortSignal | undefined)?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        }
        if (step === "empty") return { candidates: [] };
        if ("status" in step) throw Object.assign(new Error(FAKE_PROVIDER_FAILURE_MESSAGE), { status: step.status });
        if ("text" in step) return { text: step.text };
        return { text: JSON.stringify(step.reply) };
      },
    },
  };
};

/** Test values only — not an operational decision, and not a real region or project. */
export const FIXTURE_VERTEX_CONFIGURATION: NutritionVertexProviderConfiguration = Object.freeze({
  project: "fixture-project",
  location: "fixture-location",
  temperature: 0.3,
  maxOutputTokens: 4096,
  thinkingLevel: "LOW",
  timeoutMs: 2_000,
  maxTransportAttempts: 2,
});

/** Test timing only: the fixture lease, as the NUT-11 fixtures use it. */
export const FIXTURE_VERTEX_DEPLOYMENT: NutritionVertexDeployment = Object.freeze({
  provider: FIXTURE_VERTEX_CONFIGURATION,
  operationLeaseMs: 60_000,
});

/** German fixture meal names by slot; meaningless beyond being German display text. */
const GERMAN_NAMES: Readonly<Record<NutritionSlotId, string>> = {
  breakfast: "Haferbrei mit Beeren",
  lunch: "Linsensuppe mit Brot",
  snack_1: "Apfel mit Mandeln",
  dinner: "Gemüsepfanne mit Reis",
  snack_2: "Joghurt mit Nüssen",
};

/** A reply in the transport shape for `slotOrder`: seven days, one meal per slot, arbitrary values. */
export const fixtureVertexReply = (
  slotOrder: readonly NutritionSlotId[],
  meal: (slotId: NutritionSlotId, dayIndex: number) => Record<string, unknown> = (slotId, dayIndex) => ({
    slotId,
    name: `${GERMAN_NAMES[slotId]} ${dayIndex + 1}`,
    values: { kcal: 400 + dayIndex, proteinG: 25, carbsG: 45, fatG: 12 },
  })
) => ({
  days: Array.from({ length: 7 }, (_, dayIndex) => ({ meals: slotOrder.map((slotId) => meal(slotId, dayIndex)) })),
});

/** Deterministic server meal ids for tests: `meal-1`, `meal-2`, … */
export const fixtureMealIds = () => {
  let minted = 0;
  return () => `meal-${(minted += 1)}`;
};
