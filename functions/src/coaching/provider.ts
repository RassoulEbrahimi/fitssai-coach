import type { PlanGenerationInput } from "./planGenerationInput";

/**
 * The seam a future model provider plugs into.
 *
 * Two rules make this interface worth having:
 *
 *  1. It is provider-neutral. Nothing in the signatures names a vendor, so
 *     swapping one for another is a new file, not a refactor of the callers.
 *
 *  2. It returns `unknown`. A provider is an untrusted source — it can return
 *     prose where a plan was asked for, four weeks with six days, or nothing
 *     at all. Validation belongs to the caller, which runs the shared plan
 *     schema over the result before anything is persisted. If the provider
 *     were allowed to return a typed plan, the provider would have become the
 *     validation boundary, and a confidently-typed lie would pass straight
 *     through.
 *
 * The implementation is `createGeminiProvider` in `providers/gemini.ts`, which
 * is server-side only: the provider package is a dependency of the functions
 * workspace and appears nowhere in the client's.
 */

export interface WeeklyReviewFacts {
  scheduledDays: number;
  completedDays: number;
  adherencePercent: number | null;
  measuredDurationSec: number | null;
  goal?: PlanGenerationInput["goal"];
}

export interface CoachProvider {
  /** Identifies the implementation in logs. Never a key or an endpoint. */
  readonly id: string;

  /** Raw, unvalidated plan output. The caller validates before persisting. */
  generatePlan(input: PlanGenerationInput): Promise<unknown>;

  /** Raw, unvalidated prose over facts the deterministic layer computed. */
  summariseWeeklyReview(input: WeeklyReviewFacts): Promise<unknown>;
}

/**
 * Resolve the configured provider.
 *
 * The concrete implementation lives in `providers/gemini.ts` and is built by
 * the callable, which is where the API key is available. This stays a lookup
 * seam rather than a constructor so the interface keeps no opinion about which
 * vendor is behind it — swapping one is a new file in `providers/`, not a
 * refactor of the callers.
 */
export const getCoachProvider = (): CoachProvider | null => null;
