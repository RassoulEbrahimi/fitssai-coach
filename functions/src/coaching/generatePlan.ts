import type { Firestore } from "firebase-admin/firestore";
import { validateWorkoutPlanContent, type WorkoutPlanContent } from "../../../shared/workoutPlan";
import { AiError, isAiError, type AiErrorCode } from "../errors";
import { requireAuth, type AuthContextLike } from "../auth";
import {
  requireValidRequestId,
  type OperationStore,
  type OperationTransaction,
} from "../idempotency";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import type { ReservingQuotaStore, QuotaTransactionLike } from "../quota/firestoreQuotaStore";
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
 * The other half of the order is what happens after the provider answers. One
 * logical request must converge on at most one plan and at most one charge no
 * matter where it is interrupted — the callable response can be lost, the
 * client can time out and retry, the invocation can be duplicated, and the
 * process can die at any line. That is only true if the plan and the record
 * saying the plan exists commit together, and if nothing after that commit can
 * undo either. Both properties live in `finalize` below.
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

  /**
   * The quota figures for a call that has already succeeded.
   *
   * A read that fails must not turn a committed plan into an error, so this
   * one falls back to arithmetic rather than propagating. The plan is on disk
   * either way; the number next to it is the only thing at stake.
   */
  const summaryOrEstimate = async (): Promise<QuotaSummary> =>
    summary().catch(() => ({ remaining: 0, limit, period: deps.quota.currentPeriod() }));

  /**
   * Telemetry, which is never allowed to decide anything.
   *
   * `.catch()` alone is not enough: a writer that throws synchronously never
   * returns a promise to catch, and that throw would otherwise travel into the
   * handler's failure path and turn a finished generation into an error.
   */
  const logSafely = async (entry: PlanGenerationLogEntry): Promise<void> => {
    try {
      await deps.log(entry);
    } catch {
      // An observability outage is not a product failure.
    }
  };

  const fail = async (
    error: AiError,
    context: {
      providerCalled: boolean;
      repairUsed?: boolean;
      usage?: TokenUsage;
      startedAt: number;
      claimToken?: string;
    }
  ): Promise<never> => {
    await deps.operations
      .fail({
        uid,
        requestId,
        claimToken: context.claimToken,
        releaseQuota: (tx) =>
          deps.quota.releaseInTransaction(tx as QuotaTransactionLike, {
            uid,
            action: ACTION,
            requestId,
          }),
      })
      .catch(() => undefined);
    await logSafely({
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
    });
    throw error;
  };

  const startedAt = Date.now();

  // 2. The profile, before anything is claimed or charged. It is free to
  //    refuse and refuses with the missing field names, so a user who has not
  //    finished onboarding never consumes one of their three generations.
  let input;
  try {
    input = await buildPlanGenerationInput(deps.firestore, uid);
  } catch (error) {
    const aiError = isAiError(error)
      ? error
      : new AiError("INTERNAL", "Failed to read the profile.");
    return fail(aiError, { providerCalled: false, startedAt });
  }

  /*
    3. Claim the request id and take its one quota reservation, together.

    A replay returns the first call's plan without calling the provider again
    or charging a second time. A retry of an attempt that died mid-flight
    inherits the reservation and the plan id the dead attempt reserved, so an
    interrupted generation costs a user one plan, not two.
  */
  const claim = await deps.operations.claim({
    uid,
    requestId,
    mintPlanId: () => deps.newPlanId?.() ?? deps.firestore.collection("users").doc().id,
    reserveQuota: async (tx, leaseExpiresAt) =>
      (await deps.quota.reserveInTransaction(tx as QuotaTransactionLike, {
        uid,
        action: ACTION,
        requestId,
        limit,
        expiresAt: leaseExpiresAt,
      })) !== null,
  });

  if (claim.kind === "replay") {
    /*
      The reconciliation path: this is what a browser reaches after a response
      it never saw. It already knows a plan exists, so a quota read that fails
      here must not turn that plan back into an error the user has to retry.
    */
    return { ok: true, planId: claim.planId, quota: await summaryOrEstimate(), replay: true };
  }
  if (claim.kind === "in_progress") {
    throw new AiError("REQUEST_IN_PROGRESS", "An identical request is already running.");
  }
  if (claim.kind === "quota_exceeded") {
    return fail(
      new AiError("QUOTA_EXCEEDED", "Monthly generation limit reached.", {
        limit,
        period: deps.quota.currentPeriod(),
      }),
      { providerCalled: false, startedAt }
    );
  }

  const { claimToken } = claim;
  let usage: TokenUsage = {};
  let repairUsed = false;

  /*
    Everything that can still fail, in one place.

    The commit is the last statement in it on purpose: what follows the
    try/catch below runs only when the plan is on disk and paid for, and the
    catch cannot see it. That is what keeps "a plan that exists is never
    unmade" a property of the shape of this function rather than of a flag
    somebody has to remember to check.
  */
  const generateAndCommit = async (): Promise<
    { kind: "committed"; planId: string } | { kind: "superseded"; planId: string }
  > => {
    // 4. Attempt one, then at most one repair. Never a loop.
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
      throw new AiError("MODEL_OUTPUT_INVALID", "Model output failed validation.");
    }

    // Safe: collectIssues returns empty only when the parse succeeded.
    const content = validateWorkoutPlanContent(attempt.output) as {
      ok: true;
      content: WorkoutPlanContent;
    };

    /*
      5. Persist the plan and complete the operation in one transaction.

      Written with `create` at the id the claim reserved, so a duplicate
      invocation of the same request cannot add a second document, and so the
      plan and the record that says it exists can only appear together. The
      client never holds the plan and never chooses its id, and no existing
      plan is touched.
    */
    const outcome = await commitPlan(deps, {
      uid,
      requestId,
      claimToken,
      content: content.content,
      at: now(),
    });

    if (outcome.kind === "lost") {
      // Another invocation owns this request now and has not finished. This
      // one's work is discarded rather than written over theirs; the
      // reservation stays with the request, so nothing is refunded for it.
      throw new AiError("REQUEST_IN_PROGRESS", "Another invocation owns this request.");
    }

    return outcome;
  };

  let outcome: { kind: "committed" | "superseded"; planId: string };
  try {
    outcome = await generateAndCommit();
  } catch (error) {
    const aiError = isAiError(error)
      ? error
      : new AiError("INTERNAL", "Plan generation failed.");
    return fail(aiError, { providerCalled: true, repairUsed, usage, startedAt, claimToken });
  }

  // 6. The plan exists and is paid for. Nothing from here on may release the
  //    reservation, mark the operation failed, or throw — a logging outage is
  //    not a reason to tell a user the plan they now have does not exist.
  if (outcome.kind === "superseded") {
    // Another invocation already finished this request. Its plan is the
    // answer, and it is already charged for.
    return { ok: true, planId: outcome.planId, quota: await summaryOrEstimate(), replay: true };
  }

  await logSafely({
    uid,
    action: ACTION,
    status: "success",
    provider: GEMINI_PROVIDER_ID,
    model: GEMINI_MODEL_ID,
    providerCalled: true,
    schemaRepairUsed: repairUsed,
    planId: outcome.planId,
    latencyMs: Date.now() - startedAt,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    createdAt: now().toISOString(),
  });

  return { ok: true, planId: outcome.planId, quota: await summaryOrEstimate(), replay: false };
};

/**
 * Commit the plan document and the completed operation record together.
 *
 * A refused write means neither happened: there is no window in which a plan
 * exists while the bookkeeping still calls the request unfinished, which is
 * the state that let one click become two plans and two charges.
 */
const commitPlan = async (
  deps: PlanGenerationDeps,
  args: {
    uid: string;
    requestId: string;
    claimToken: string;
    content: WorkoutPlanContent;
    at: Date;
  }
) => {
  const planRef = (planId: string) =>
    deps.firestore
      .collection("users")
      .doc(args.uid)
      .collection("workout_plans")
      .doc(planId);

  try {
    return await deps.operations.finalize({
      uid: args.uid,
      requestId: args.requestId,
      claimToken: args.claimToken,
      consumeQuota: (tx: OperationTransaction) =>
        deps.quota.consumeInTransaction(tx as QuotaTransactionLike, {
          uid: args.uid,
          action: ACTION,
          requestId: args.requestId,
        }),
      writeResult: (tx: OperationTransaction, planId: string) => {
        tx.create(planRef(planId), {
          content: args.content,
          createdAt: args.at,
          updatedAt: args.at,
          source: "ai",
          provider: GEMINI_PROVIDER_ID,
          model: GEMINI_MODEL_ID,
        });
      },
    });
  } catch {
    throw new AiError("PERSISTENCE_FAILED", "Failed to store the generated plan.");
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
