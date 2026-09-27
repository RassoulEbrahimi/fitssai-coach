/**
 * The backend safety gate for Nutrition AI generation (NUT-12B).
 *
 * OFF. While it is, `nutritionRequestPlan` starts no new generation work: a
 * new request, and a takeover of an expired one that would call the
 * generator, are refused `NUTRITION_AI_DISABLED` before the generator
 * registry is consulted, and nothing is written — no request, no operation
 * record, no state change, no plan. What is already stored is still answered:
 * a finished request replays and a live one is reported as running.
 *
 * This is not a feature flag and nothing outside this file can move it. It is
 * a reviewed constant, independent of `NUTRITION_V2_ENABLED`,
 * `BACKEND_CAPABILITIES`, the browser, the environment and the generator
 * registry: no environment variable, emulator or test runner changes it.
 * Tests exercise the lifecycle by injecting `generationEnabled: true` into the
 * handler explicitly; the deployed callable passes this value.
 *
 * It moves only with the signed-off NUT-12C decisions it waits for: the Vertex
 * project and location, data processing and the legal basis, the target and
 * plan-validation policies, first-plan slots, operational limits and quota.
 */
export const NUTRITION_AI_PRODUCTION_ENABLED: boolean = false;
