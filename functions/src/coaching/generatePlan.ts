import type { Firestore } from "firebase-admin/firestore";
import { validateWorkoutPlanContent, type WorkoutPlanContent } from "../../../shared/workoutPlan";
import { AiError, isAiError, type AiErrorCode } from "../errors";
import { requireAuth, type AuthContextLike } from "../auth";
import { requireValidRequestId, type OperationStore } from "../idempotency";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import type { ReservingQuotaStore } from "../quota/firestoreQuotaStore";
import type { PlanGenerationLogEntry } from "../logging/firestoreAiLogWriter";
import { buildPlanGenerationInput } from "./profileInput";
import { validatePlanSemantics } from "./semanticValidation";
import type { GeminiProvider, TokenUsage } from "./providers/gemini";
import { GEMINI_MODEL_ID, GEMINI_PROVIDER_ID } from "./providers/gemini";

/**
 * The plan-generation orchestration.
 *
 * Order matters, and the order is: identity, then idempotency, then the
 * profile, then quota, and only then the provider. Everything that can refuse
 * the request for free runs before the one step that costs money.
 *
 * The handler takes its collaborators as arguments so the whole pipeline —
 * including the paths that must *not* call the provider — is testable without
 * a network, a deployment or an emulator.
 */

export interface PlanGenerationDeps {
  firestore: Firestore;
  provider: GeminiProvider;
  quota: ReservingQuotaStore;
  operations: OperationStore;
  log: (entry: PlanGenerationLogEntry) => Promise<void>;
  now?: () => Date;
  newPlanId?: () => string;
}

export interface GeneratePlanRequest extends AuthContextLike {
  data?: unknown;
}

export interface QuotaSummary {
  remaining: number;
  limit: number;
  period: string;
}

export interface GeneratePlanResult {
  ok: true;
  planId: string;
  quota: QuotaSummary;
  /** True when this call replayed a completed request rather than generating. */
  replay: boolean;
}

const ACTION = "plan_generation" as const;

/** Compact, machine-readable feedback for the single repair attempt. */
const repairInstruction = (issues: Array<{ path: string; message: string }>): string =>
  [
    "Die vorherige Antwort war ungültig. Korrigiere genau diese Punkte und gib",
    "erneut ausschließlich die vollständige JSON-Struktur zurück:",
    ...issues.slice(0, 12).map((issue) => `- ${issue.path}: ${issue.message}`),
  ].join("\n");

const readRequestId = (data: unknown): string => {
  const requestId = (data as { requestId?: unknown } | null | undefined)?.requestId;
  return requireValidRequestId(requestId);
};

export const handleGenerateWorkoutPlan = async (
  request: GeneratePlanRequest,
  deps: PlanGenerationDeps
): Promise<GeneratePlanResult> => {
  const now = deps.now ?? (() => new Date());
  const limit = DEFAULT_QUOTA_LIMITS[ACTION];

  // 1. Identity from the verified token. A uid in the payload is not read.
  const { uid } = requireAuth(request);
  const requestId = readRequestId(request.data);

  const summary = async (): Promise<QuotaSummary> => {
    const used = await deps.quota.getUsage(uid, ACTION);
    return { remaining: Math.max(0, limit - used), limit, period: deps.quota.currentPeriod() };
  };

  const fail = async (
    error: AiError,
    context: { providerCalled: boolean; repairUsed?: boolean; usage?: TokenUsage; startedAt: number }
  ): Promise<never> => {
    await deps.operations.fail(uid, requestId).catch(() => undefined);
    await deps
      .log({
        uid,
        action: ACTION,
        status: "error",
        errorCategory: LOG_CATEGORY[error.code],
        provider: context.providerCalled ? GEMINI_PROVIDER_ID : undefined,
        model: context.providerCalled ? GEMINI_MODEL_ID : undefined,
        providerCalled: context.providerCalled,
        schemaRepairUsed: context.repairUsed,
        latencyMs: Date.now() - context.startedAt,
        inputTokens: context.usage?.inputTokens,
        outputTokens: context.usage?.outputTokens,
        createdAt: now().toISOString(),
      })
      .catch(() => undefined);
    throw error;
  };

  const startedAt = Date.now();

  // 2. Claim the request id. A replay returns the first call's plan without
  //    calling the provider again or charging a second time.
  const claim = await deps.operations.claim(uid, requestId);
  if (claim.kind === "replay") {
    return { ok: true, planId: claim.planId, quota: await summary(), replay: true };
  }
  if (claim.kind === "in_progress") {
    throw new AiError("REQUEST_IN_PROGRESS", "An identical request is already running.");
  }

  // 3. The profile. Free to refuse, and refuses with the missing field names.
  let input;
  try {
    input = await buildPlanGenerationInput(deps.firestore, uid);
  } catch (error) {
    const aiError = isAiError(error)
      ? error
      : new AiError("INTERNAL", "Failed to read the profile.");
    return fail(aiError, { providerCalled: false, startedAt });
  }

  // 4. Reserve quota before spending money. The reservation is transactional,
  //    so two simultaneous requests cannot both take the last one; it is given
  //    back on every failure below, so only a persisted plan stays charged.
  const reserved = await deps.quota.reserve(uid, ACTION, limit);
  if (reserved === null) {
    return fail(
      new AiError("QUOTA_EXCEEDED", "Monthly generation limit reached.", {
        limit,
        period: deps.quota.currentPeriod(),
      }),
      { providerCalled: false, startedAt }
    );
  }

  const release = async () => {
    await deps.quota.release(uid, ACTION).catch(() => undefined);
  };

  let usage: TokenUsage = {};
  let repairUsed = false;

  try {
    // 5. Attempt one, then at most one repair. Never a loop.
    let attempt = await deps.provider.generatePlanWithUsage(input);
    usage = attempt.usage;
    let issues = collectIssues(attempt.output, input);

    if (issues.length > 0) {
      repairUsed = true;
      attempt = await deps.provider.generatePlanWithUsage(input, repairInstruction(issues));
      usage = mergeUsage(usage, attempt.usage);
      issues = collectIssues(attempt.output, input);
    }

    if (issues.length > 0) {
      await release();
      return fail(new AiError("MODEL_OUTPUT_INVALID", "Model output failed validation."), {
        providerCalled: true,
        repairUsed,
        usage,
        startedAt,
      });
    }

    // Safe: collectIssues returns empty only when the parse succeeded.
    const content = validateWorkoutPlanContent(attempt.output) as {
      ok: true;
      content: WorkoutPlanContent;
    };

    // 6. Persist with the Admin SDK. The client never holds the plan and never
    //    chooses its id, and no existing plan is touched.
    const planId = deps.newPlanId?.() ?? deps.firestore.collection("users").doc().id;
    try {
      await deps.firestore
        .collection("users")
        .doc(uid)
        .collection("workout_plans")
        .doc(planId)
        .create({
          content: content.content,
          createdAt: now(),
          updatedAt: now(),
          source: "ai",
          provider: GEMINI_PROVIDER_ID,
          model: GEMINI_MODEL_ID,
        });
    } catch {
      await release();
      return fail(new AiError("PERSISTENCE_FAILED", "Failed to store the generated plan."), {
        providerCalled: true,
        repairUsed,
        usage,
        startedAt,
      });
    }

    await deps.operations.complete(uid, requestId, planId);

    await deps
      .log({
        uid,
        action: ACTION,
        status: "success",
        provider: GEMINI_PROVIDER_ID,
        model: GEMINI_MODEL_ID,
        providerCalled: true,
        schemaRepairUsed: repairUsed,
        planId,
        latencyMs: Date.now() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        createdAt: now().toISOString(),
      })
      .catch(() => undefined);

    return { ok: true, planId, quota: await summary(), replay: false };
  } catch (error) {
    await release();
    const aiError = isAiError(error)
      ? error
      : new AiError("INTERNAL", "Plan generation failed.");
    return fail(aiError, { providerCalled: true, repairUsed, usage, startedAt });
  }
};

/** Schema issues first, then semantic ones — both feed the repair attempt. */
const collectIssues = (
  output: unknown,
  input: Parameters<typeof validatePlanSemantics>[1]
): Array<{ path: string; message: string }> => {
  const parsed = validateWorkoutPlanContent(output);
  if (!parsed.ok) return parsed.issues;
  return validatePlanSemantics(parsed.content, input);
};

const mergeUsage = (first: TokenUsage, second: TokenUsage): TokenUsage => {
  const add = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: add(first.inputTokens, second.inputTokens),
    outputTokens: add(first.outputTokens, second.outputTokens),
    totalTokens: add(first.totalTokens, second.totalTokens),
  };
};

/** Our error vocabulary mapped onto the log's coarser categories. */
const LOG_CATEGORY: Readonly<Record<AiErrorCode, PlanGenerationLogEntry["errorCategory"]>> = {
  UNAUTHENTICATED: "internal_error",
  INVALID_REQUEST: "internal_error",
  PROFILE_INCOMPLETE: "internal_error",
  QUOTA_EXCEEDED: "quota_exceeded",
  REQUEST_IN_PROGRESS: "internal_error",
  PROVIDER_RATE_LIMITED: "provider_timeout",
  PROVIDER_UNAVAILABLE: "provider_error",
  MODEL_OUTPUT_INVALID: "invalid_output",
  PERSISTENCE_FAILED: "internal_error",
  INTERNAL: "internal_error",
};
