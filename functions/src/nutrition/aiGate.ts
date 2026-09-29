/**
 * The backend safety gate for Nutrition AI generation (NUT-12B).
 *
 * ON since NUT-14. The operator signed off production use on 2026-09-29
 * ("APPROVE FOR NUT-14"): the Vertex project and location, the minimized
 * generation payload, the target and plan-validation policies, first-plan
 * slots, operational limits and quota (NUT-12C) are all in force. With the
 * gate on, `nutritionRequestPlan` starts new generation work for an eligible
 * account through the signed production deployment — still behind every other
 * check: authentication, eligibility, the provider, policy and slot
 * configuration, the current target, the dietary preference and the quota.
 *
 * This is not a feature flag and nothing outside this file can move it. It is
 * a reviewed constant, independent of `NUTRITION_V2_ENABLED`,
 * `BACKEND_CAPABILITIES`, the browser, the environment and the generator
 * registry: no environment variable, emulator or test runner changes it.
 * Tests exercise both states by injecting `generationEnabled` into the handler
 * explicitly; the deployed callable passes this value.
 *
 * Rollback: set it back to `false` together with
 * `BACKEND_CAPABILITIES.nutritionGeneration`, and deploy `nutritionRequestPlan`
 * and `coachBackendStatus`. Closed, a new request, and a takeover of an expired
 * one that would call the generator, are refused `NUTRITION_AI_DISABLED`
 * before the generator registry is consulted, and nothing is written. What is
 * already stored is still answered and kept: a finished request replays, a
 * live one is reported as running, and no plan, target, entry, generation
 * document or quota ledger is deleted.
 */
export const NUTRITION_AI_PRODUCTION_ENABLED: boolean = true;
