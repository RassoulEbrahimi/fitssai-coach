import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  addNutritionDays,
  answeredValue,
  assertGenerationRequestTransition,
  generationRequestSchema,
  getNutritionEligibility,
  isTerminalGenerationRequestStatus,
  nutritionDateAt,
  nutritionGenerationIdempotencyKey,
  nutritionUserStateSchema,
  parseNutritionProfile,
  type GenerationRequest,
  type NutritionGenerationFailureCode,
  type NutritionGenerationStaleCode,
  type NutritionPlan,
  type NutritionProfile,
  type NutritionUserState,
  type Sha256Hex,
  type TargetVersion,
} from "../../../shared/nutrition";
import { operationLeaseExpiry, type OperationRecord, type OperationRecordStore } from "../operationRecords";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import { quotaPeriod, type QuotaLedger, type QuotaTransactionLike, type ReservingQuotaStore } from "../quota/firestoreQuotaStore";
import { NutritionGenerationError, NutritionPlanError } from "./errors";
import {
  buildNutritionGenerationInput,
  computeNutritionGenerationFingerprint,
  type NutritionGenerationInput,
  type NutritionInitialSlotConfiguration,
} from "./generationInput";
import {
  NutritionGenerationProviderConfigurationError,
  type NutritionGenerationProviderRegistry,
  type NutritionGenerationSetup,
} from "./generationProvider";
import {
  activateNutritionPlanInTransaction,
  parseNutritionStateSnapshot,
  requireStoredPlan,
  requireStoredTarget,
  type ActivationTransaction,
  type PreparedNutritionPlanActivation,
} from "./planActivation";
import type { PlanValidationPolicy, PlanValidationPolicyRegistry } from "./planValidation/types";

/**
 * The transactions of one Nutrition generation request (NUT-11). Each reads
 * everything it decides on before its first write, and writes all of its
 * documents or none:
 *
 *   claim     the request document, its `_ai_operations` record (namespace
 *             `nutritionPlan`) and the account state's
 *             `activeGenerationRequestId` — together, so the state never names
 *             a request that does not exist and no request runs unnamed
 *   finalize  the plan activation (the NUT-09 core, in this transaction), the
 *             request → succeeded and the record → completed; or, when the
 *             account moved on, the request → discarded_stale and nothing else
 *   fail      the request → failed and the record → failed
 *
 * The lifecycle is forward-only (`assertGenerationRequestTransition`): a request
 * is created `running` and ends once, as succeeded, failed or discarded_stale.
 * Nothing cancels it. The claim's token and lease decide which invocation may
 * end it, so a slow invocation that lost its claim can neither finish nor fail
 * the request under its successor.
 *
 * One active generation per account. The state pointer names it, and a claim
 * resolves an existing pointer before taking the slot:
 *
 *   names this request                    it continues (below)
 *   names a live request (lease running)  that request is answered; nothing is written
 *   names a finished request              the pointer is cleared with the new claim
 *   names a request whose invocation is
 *   gone (lease run out)                  that request → failed GENERATION_ABANDONED,
 *                                         with the new claim
 *   names nothing that parses, or its
 *   record disagrees with it              INTERNAL — never read as "no generation"
 *
 * The same request id again:
 *
 *   finished        its outcome, unchanged (a failed request is not restarted)
 *   live elsewhere  answered as running; no second generation starts
 *   lease run out   taken over as the SAME request: same document, same
 *                   reserved plan id, same fingerprint — the input is rebuilt
 *                   and must hash to it, or the request ends discarded_stale
 *                   INPUT_CHANGED; a changed plan or target ends it as stale too
 *
 * Eligibility (NUT-03) is decided by the profile each transaction reads
 * itself, never by a copy taken earlier: a claim for an account that is not an
 * eligible adult is refused (NOT_ELIGIBLE, nothing written); a takeover or a
 * finalisation that finds it no longer eligible ends the request
 * discarded_stale ELIGIBILITY_CHANGED without a plan. Existing data stays;
 * nothing is extended.
 *
 * Answering for an existing request needs nothing configured: a finished
 * request replays, and a live one — this request or another — is answered,
 * whatever the gate, the generator or the policy registry says now. Only new
 * work — a new request, or a takeover that would call the generator — needs
 * the backend AI gate on (NUTRITION_AI_DISABLED, NUT-12B), a dietary
 * preference generation supports (DIETARY_PREFERENCE_NOT_SUPPORTED: keto,
 * NUT-12C.2), a configured generator (GENERATION_PROVIDER_NOT_CONFIGURED), a
 * policy in force (PLAN_VALIDATION_POLICY_NOT_CONFIGURED), the generator's
 * operation lease and, judged last, a unit of the month's allowance
 * (QUOTA_EXCEEDED), and it is refused before anything is written. The gate is
 * judged first, and the generator registry is not even asked while it is off.
 *
 * With the gate off, an expired request is left exactly as it is: still
 * `running`, its record and the state pointer untouched, answered
 * NUTRITION_AI_DISABLED — just as, with the gate on and no generator, it is
 * answered GENERATION_PROVIDER_NOT_CONFIGURED. It is not ended as abandoned,
 * because the gate says nothing about the request; a later
 * call with the gate on takes it over or ends it as the lifecycle says. A
 * takeover that finds the request stale still ends it discarded_stale first:
 * that is convergence, not work, and needs no generator.
 *
 * State revision: a transaction that changes the state document moves
 * `revision` by exactly one (claim, activation, a failure or discard that
 * clears the pointer); one that does not change it does not write it.
 *
 * Quota (NUT-12C.2): one `nutrition_plan_generation` unit per logical
 * request, on the existing `_ai_quota` store, settled in the same transaction
 * as the lifecycle step it belongs to:
 *
 *   claim of a new request   reserves one unit, held until the claim's lease
 *                            runs out; none left → QUOTA_EXCEEDED, nothing
 *                            written. Judged last, after every free refusal
 *   takeover                 renews the SAME request's hold for the new lease —
 *                            never a second unit
 *   finalize, activated      the hold becomes a permanent charge, with the plan
 *   any end without a plan   the hold is released: failed (including
 *                            GENERATION_ABANDONED), or discarded_stale
 *   answering, replaying     nothing
 *
 * A lost invocation ends nothing, so it releases nothing: the successor's hold
 * is the successor's. The hold is always in the UTC month the request was
 * created in (`nutritionGenerationQuotaPeriod`), so a request claimed on the
 * 30th and finished on the 1st settles the unit it took, never next month's.
 *
 * Every transaction reads the quota document with its other reads and
 * changes it after them (`QuotaLedger`): reads stay before writes, including
 * the activation core's own.
 */

type Snapshot = { exists: boolean; data(): Record<string, unknown> | undefined };

export interface NutritionGenerationContext {
  firestore: Firestore;
  uid: string;
  /** The `nutritionPlan` operation records. Reading them needs no lease. */
  records: OperationRecordStore;
  policies: PlanValidationPolicyRegistry;
  initialSlots: NutritionInitialSlotConfiguration;
  sha256Hex: Sha256Hex;
  /** The server's quota store. Only its transactional ledger is used. */
  quota: Pick<ReservingQuotaStore, "readLedgerInTransaction">;
}

/** Nutrition's own allowance: never Training's `plan_generation`. */
export const NUTRITION_GENERATION_QUOTA_ACTION = "nutrition_plan_generation" as const;

const internal = (message: string) => new NutritionGenerationError("INTERNAL", message);

/**
 * The UTC month a request's quota hold is counted in: the month of its first
 * claim, read from the immutable `createdAt`, for the request's whole life.
 */
export const nutritionGenerationQuotaPeriod = (request: Pick<GenerationRequest, "createdAt">): string =>
  quotaPeriod(new Date(request.createdAt.seconds * 1000 + Math.floor(request.createdAt.nanoseconds / 1_000_000)));

/** `request`'s quota document, read inside `tx`. Callers read it with their other reads, before any write. */
const readQuotaLedger = (
  ctx: NutritionGenerationContext,
  tx: ActivationTransaction,
  request: Pick<GenerationRequest, "createdAt">
): Promise<QuotaLedger> =>
  ctx.quota.readLedgerInTransaction(tx as unknown as QuotaTransactionLike, {
    uid: ctx.uid,
    action: NUTRITION_GENERATION_QUOTA_ACTION,
    period: nutritionGenerationQuotaPeriod(request),
  });

/**
 * Keto is part of the profile vocabulary, but no generated plan is Keto: a
 * standard target is not a Keto target. Refused before any paid work, and
 * never substituted by another preference.
 */
const requireSupportedDietaryPreference = (profile: NutritionProfile): void => {
  if (answeredValue(profile.dietaryPreference) === "keto") {
    throw new NutritionGenerationError("DIETARY_PREFERENCE_NOT_SUPPORTED", "Nutrition plan generation does not support this dietary preference.");
  }
};

const runTransaction = <T>(firestore: Firestore, body: (tx: ActivationTransaction) => Promise<T>): Promise<T> =>
  (
    firestore as unknown as {
      runTransaction: (fn: (tx: ActivationTransaction) => Promise<T>) => Promise<T>;
    }
  ).runTransaction(body);

const refsFor = (firestore: Firestore, uid: string) => {
  const userRef = firestore.collection("users").doc(uid);
  return {
    user: userRef,
    state: userRef.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID),
    plan: (planId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.plans).doc(planId),
    target: (targetVersionId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.targets).doc(targetVersionId),
    generation: (requestId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.generations).doc(requestId),
  };
};

const structural = (at: Date) => {
  const timestamp = Timestamp.fromDate(at);
  return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
};

/** The request stored under `requestId`, or null. A stored request that does not parse is an integrity failure. */
const parseGenerationRequest = (snapshot: Snapshot, requestId: string): GenerationRequest | null => {
  if (!snapshot.exists) return null;
  const parsed = generationRequestSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A generation request is malformed.");
  if (parsed.data.requestId !== requestId) throw internal("A generation request is stored under another request's id.");
  return parsed.data;
};

/** The account's NUT-03 profile view, read inside `tx`: the one eligibility answer that counts. */
const readProfile = async (ctx: NutritionGenerationContext, tx: ActivationTransaction): Promise<NutritionProfile> =>
  parseNutritionProfile((await tx.get(refsFor(ctx.firestore, ctx.uid).user)).data());

/** What any new work needs first: the backend AI gate on. Throws before anything is written. */
const requireGenerationEnabled = (generationEnabled: boolean): void => {
  if (generationEnabled !== true) throw new NutritionGenerationError("NUTRITION_AI_DISABLED", "Nutrition AI generation is disabled.");
};

/** The generator in force, resolved only now; an incomplete configuration is refused, never defaulted. */
const resolveSetup = (providers: NutritionGenerationProviderRegistry): NutritionGenerationSetup | null => {
  try {
    return providers.current();
  } catch (error) {
    if (error instanceof NutritionGenerationProviderConfigurationError) {
      throw new NutritionGenerationError("GENERATION_PROVIDER_NOT_CONFIGURED", "The Nutrition generation provider is misconfigured.");
    }
    throw error;
  }
};

/**
 * What new work needs after the gate: a configured generator with its
 * operation lease and a policy in force. Throws before anything is written
 * when any is missing.
 */
const requireWork = (
  ctx: NutritionGenerationContext,
  providers: NutritionGenerationProviderRegistry
): { setup: NutritionGenerationSetup; policy: PlanValidationPolicy } => {
  const setup = resolveSetup(providers);
  if (!setup) throw new NutritionGenerationError("GENERATION_PROVIDER_NOT_CONFIGURED", "No Nutrition generation provider is configured.");
  const policy = ctx.policies.current();
  if (!policy) throw new NutritionGenerationError("PLAN_VALIDATION_POLICY_NOT_CONFIGURED", "No plan-validation policy is in force.");
  if (!Number.isFinite(setup.operationLeaseMs) || setup.operationLeaseMs <= 0) {
    throw internal("The generation provider is configured without an operation lease.");
  }
  return { setup, policy };
};

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

type DerivedInput =
  | { ok: true; input: NutritionGenerationInput; fingerprint: string }
  | { ok: false; code: "PLAN_NOT_REGENERABLE" | "GENERATION_SLOTS_NOT_CONFIGURED" };

/**
 * The minimized input for a base (or none) and a target, at `at`:
 *
 *   initial     starts today (Berlin, server clock), with the injected
 *               first-plan slots
 *   regenerate  starts tomorrow; the base plan keeps today, so it must own a
 *               date before tomorrow — a base that starts tomorrow or later is
 *               refused, never shifted
 */
const deriveInput = async (
  ctx: NutritionGenerationContext,
  profile: NutritionProfile,
  basePlan: NutritionPlan | null,
  target: TargetVersion,
  at: Date
): Promise<DerivedInput> => {
  const today = nutritionDateAt(at);
  let startDate: string;
  let slotOrder: NutritionPlan["slotOrder"];
  if (basePlan) {
    if (basePlan.startDate > today) return { ok: false, code: "PLAN_NOT_REGENERABLE" };
    startDate = addNutritionDays(today, 1);
    slotOrder = basePlan.slotOrder;
  } else {
    const slots = ctx.initialSlots.slotsFor(answeredValue(profile.mealsPerDay));
    if (!slots) return { ok: false, code: "GENERATION_SLOTS_NOT_CONFIGURED" };
    startDate = today;
    slotOrder = [...slots];
  }
  let input: NutritionGenerationInput;
  try {
    input = buildNutritionGenerationInput({ startDate, target, slotOrder, profile });
  } catch {
    throw internal("The generation input could not be built.");
  }
  return { ok: true, input, fingerprint: await computeNutritionGenerationFingerprint(input, ctx.sha256Hex) };
};

/* ------------------------------------------------------------------ *
 * Shared writes
 * ------------------------------------------------------------------ */

/**
 * Why a running request can no longer produce the account's plan, or null
 * while it still can. `profile` is the one the calling transaction read.
 */
const staleCodeFor = (
  state: NutritionUserState | null,
  request: GenerationRequest,
  profile: NutritionProfile
): NutritionGenerationStaleCode | null => {
  if (!state || state.activeGenerationRequestId !== request.requestId) return "STALE_GENERATION";
  if (!getNutritionEligibility(profile).eligible) return "ELIGIBILITY_CHANGED";
  if (state.activePlanId !== request.basePlanId) return "STALE_ACTIVE_PLAN";
  if (state.currentTargetVersionId !== request.targetVersionId) return "STALE_TARGET";
  return null;
};

/** The request's one terminal write without a plan, and its record's. The state is the caller's. */
const writeRequestEnd = (
  ctx: NutritionGenerationContext,
  tx: ActivationTransaction,
  request: GenerationRequest,
  end: { status: "failed"; code: NutritionGenerationFailureCode } | { status: "discarded_stale"; code: NutritionGenerationStaleCode },
  at: Date
): GenerationRequest => {
  const ended: GenerationRequest = { ...request, status: end.status, errorCode: end.code, finishedAt: structural(at) };
  try {
    assertGenerationRequestTransition(request, ended);
  } catch {
    throw internal("The request cannot end this way.");
  }
  tx.update(refsFor(ctx.firestore, ctx.uid).generation(request.requestId), {
    status: ended.status,
    errorCode: ended.errorCode,
    finishedAt: Timestamp.fromDate(at),
  });
  ctx.records.writeEnded(tx, {
    uid: ctx.uid,
    requestId: request.requestId,
    at,
    status: end.status === "failed" ? "failed" : "discarded",
  });
  return ended;
};

/** One state write, one revision. */
const writeState = (ctx: NutritionGenerationContext, tx: ActivationTransaction, next: NutritionUserState): void => {
  if (!nutritionUserStateSchema.safeParse(next).success) throw internal("The next state is not a valid NutritionUserState.");
  tx.set(refsFor(ctx.firestore, ctx.uid).state, next);
};

/** Clears the pointer if — and only if — it still names `requestId`. */
const clearPointerIfNamed = (
  ctx: NutritionGenerationContext,
  tx: ActivationTransaction,
  state: NutritionUserState | null,
  requestId: string
): void => {
  if (!state || state.activeGenerationRequestId !== requestId) return;
  writeState(ctx, tx, { ...state, revision: state.revision + 1, activeGenerationRequestId: null });
};

/* ------------------------------------------------------------------ *
 * Claim
 * ------------------------------------------------------------------ */

export type NutritionGenerationClaim =
  /** This invocation owns the request and may call the generator. */
  | {
      kind: "claimed";
      request: GenerationRequest;
      input: NutritionGenerationInput;
      target: TargetVersion;
      claimToken: string;
      /** The plan id reserved for this request at its first claim. */
      planId: string;
      takeover: boolean;
      /** What this work runs with, as it was when it was claimed. */
      setup: NutritionGenerationSetup;
      policy: PlanValidationPolicy;
    }
  /** A live request — this one elsewhere, or another of the account. Nothing was written. */
  | { kind: "inProgress"; request: GenerationRequest }
  /** The request is terminal: it already was (`replay`), or a takeover found it could not continue. */
  | { kind: "finished"; request: GenerationRequest; replay: boolean };

export interface NutritionGenerationClaimInput {
  requestId: string;
  at: Date;
  /** Minted before the transaction; used only by a request's first claim. */
  newPlanId: string;
  /** Minted before the transaction; this claim's proof of ownership. */
  claimToken: string;
  /** The backend AI gate. Judged only for new work, before the registry is asked. */
  generationEnabled: boolean;
  /** The generator registry. Asked only for new work, and only with the gate on. */
  providers: NutritionGenerationProviderRegistry;
}

export const claimNutritionGeneration = (
  ctx: NutritionGenerationContext,
  { requestId, at, newPlanId, claimToken, generationEnabled, providers }: NutritionGenerationClaimInput
): Promise<NutritionGenerationClaim> =>
  runTransaction(ctx.firestore, async (tx): Promise<NutritionGenerationClaim> => {
    const refs = refsFor(ctx.firestore, ctx.uid);
    // The profile joins this transaction's read set: a change to it before the
    // commit makes the transaction run again against the new answer.
    const profile = await readProfile(ctx, tx);
    const request = parseGenerationRequest(await tx.get(refs.generation(requestId)), requestId);
    const record = await ctx.records.read(tx, ctx.uid, requestId, at);
    const state = parseNutritionStateSnapshot(await tx.get(refs.state));

    if (request) return continueRequest(ctx, tx, { request, record, state, profile, at, claimToken, generationEnabled, providers });

    // A new request. Its record cannot exist without it: they are created together.
    if (record.exists) throw internal("An operation record exists without its generation request.");

    // One active generation per account: a live one is answered, whatever is configured.
    let abandoned: GenerationRequest | null = null;
    const activeId = state?.activeGenerationRequestId ?? null;
    if (activeId !== null) {
      const active = parseGenerationRequest(await tx.get(refs.generation(activeId)), activeId);
      if (!active) throw internal("The active generation request does not exist.");
      if (!isTerminalGenerationRequestStatus(active.status)) {
        const activeRecord = await ctx.records.read(tx, ctx.uid, activeId, at);
        if (activeRecord.status !== "in_progress") throw internal("The active generation request has no live record.");
        // A live request is never taken from its invocation.
        if (activeRecord.leaseLive) return { kind: "inProgress", request: active };
        abandoned = active;
      }
      // A finished request's pointer is simply replaced below.
    }

    // New work from here: the AI gate on, an eligible adult by the profile read
    // above, a dietary preference generation supports, and a configured generator.
    requireGenerationEnabled(generationEnabled);
    const eligibility = getNutritionEligibility(profile);
    if (!eligibility.eligible) {
      throw new NutritionGenerationError("NOT_ELIGIBLE", "Nutrition is for adults with a known age.", { reason: eligibility.reason });
    }
    requireSupportedDietaryPreference(profile);
    const work = requireWork(ctx, providers);
    if (!state || state.currentTargetVersionId === null) {
      throw new NutritionGenerationError("NO_CURRENT_TARGET", "No target is set.");
    }
    if (state.recentRequests.some((applied) => applied.requestId === requestId)) {
      throw new NutritionGenerationError("INVALID_REQUEST", "The request id was used for another operation.");
    }

    // The snapshot this request is for: the current target and base, as the server reads them.
    const targetVersionId = state.currentTargetVersionId;
    const target = requireStoredTarget(await tx.get(refs.target(targetVersionId)), targetVersionId);
    let basePlan: NutritionPlan | null = null;
    if (state.activePlanId !== null) {
      basePlan = requireStoredPlan(await tx.get(refs.plan(state.activePlanId)), state.activePlanId);
      if (basePlan.lifecycle.status !== "active") {
        throw new NutritionGenerationError("PLAN_NOT_ACTIVE", "The state points to a plan that is not active.");
      }
    }
    const derived = await deriveInput(ctx, profile, basePlan, target, at);
    if (!derived.ok) throw new NutritionGenerationError(derived.code, "The generation cannot be configured.");

    const created: GenerationRequest = {
      schemaVersion: NUTRITION_SCHEMA_VERSION,
      requestId,
      idempotencyKey: nutritionGenerationIdempotencyKey(requestId),
      kind: basePlan ? "regenerate" : "initial",
      basePlanId: basePlan?.planId ?? null,
      targetVersionId,
      payloadFingerprint: derived.fingerprint,
      status: "running",
      resultPlanId: null,
      errorCode: null,
      createdAt: structural(at),
      finishedAt: null,
      acknowledgedAt: null,
    };
    if (!generationRequestSchema.safeParse(created).success) throw internal("The new request is not a valid GenerationRequest.");

    // The last reads: the allowance of this request's month, and — when it is
    // another month — the abandoned request's, whose hold it gives back.
    const ledger = await readQuotaLedger(ctx, tx, created);
    const abandonedLedger =
      abandoned && nutritionGenerationQuotaPeriod(abandoned) !== ledger.period ? await readQuotaLedger(ctx, tx, abandoned) : ledger;

    // Every read is done; everything below is written together — or, when the
    // allowance is gone, nothing is. The abandoned request's unit goes back
    // first, so it can pay for this one.
    if (abandoned) abandonedLedger.release(abandoned.requestId);
    const reserved = ledger.reserve({
      requestId,
      limit: DEFAULT_QUOTA_LIMITS[NUTRITION_GENERATION_QUOTA_ACTION],
      expiresAt: operationLeaseExpiry(at, work.setup.operationLeaseMs),
    });
    if (reserved === null) throw new NutritionGenerationError("QUOTA_EXCEEDED", "The monthly Nutrition generation allowance is used up.");

    if (abandoned) writeRequestEnd(ctx, tx, abandoned, { status: "failed", code: "GENERATION_ABANDONED" }, at);
    ctx.records.writeClaim(tx, {
      uid: ctx.uid,
      requestId,
      previous: record,
      at,
      claimToken,
      planId: newPlanId,
      leaseMs: work.setup.operationLeaseMs,
    });
    tx.create(refs.generation(requestId), { ...created, createdAt: Timestamp.fromDate(at) });
    writeState(ctx, tx, { ...state, revision: state.revision + 1, activeGenerationRequestId: requestId });

    return {
      kind: "claimed",
      request: created,
      input: derived.input,
      target,
      claimToken,
      planId: newPlanId,
      takeover: false,
      ...work,
    };
  });

/** The same request id again: its outcome, its live invocation, or a takeover of it. */
const continueRequest = async (
  ctx: NutritionGenerationContext,
  tx: ActivationTransaction,
  {
    request,
    record,
    state,
    profile,
    at,
    claimToken,
    generationEnabled,
    providers,
  }: {
    request: GenerationRequest;
    record: OperationRecord;
    state: NutritionUserState | null;
    profile: NutritionProfile;
    at: Date;
    claimToken: string;
    generationEnabled: boolean;
    providers: NutritionGenerationProviderRegistry;
  }
): Promise<NutritionGenerationClaim> => {
  if (isTerminalGenerationRequestStatus(request.status)) return { kind: "finished", request, replay: true };
  if (record.status !== "in_progress" || !record.planId) throw internal("A running request has no live record.");
  if (record.leaseLive) return { kind: "inProgress", request };

  // The invocation that owned it is gone. Continue the same request, or end it
  // — ending it needs no generator; continuing does. Either settles the hold
  // the request took in its own month, read here, before any write.
  const ledger = await readQuotaLedger(ctx, tx, request);
  const stale = staleCodeFor(state, request, profile);
  if (stale) {
    const ended = writeRequestEnd(ctx, tx, request, { status: "discarded_stale", code: stale }, at);
    clearPointerIfNamed(ctx, tx, state, request.requestId);
    ledger.release(request.requestId);
    return { kind: "finished", request: ended, replay: false };
  }

  // Continuing is new work: the gate first, and the request is left as it is if it is off.
  requireGenerationEnabled(generationEnabled);
  const work = requireWork(ctx, providers);
  const refs = refsFor(ctx.firestore, ctx.uid);
  const target = requireStoredTarget(await tx.get(refs.target(request.targetVersionId)), request.targetVersionId);
  const basePlan =
    request.basePlanId === null ? null : requireStoredPlan(await tx.get(refs.plan(request.basePlanId)), request.basePlanId);
  if (basePlan && basePlan.lifecycle.status !== "active") throw internal("The base plan of a running request is not active.");

  // The same logical request must generate from the same input — never from a changed one under its id.
  // Rebuilt from the profile this transaction read, not one taken earlier.
  const derived = await deriveInput(ctx, profile, basePlan, target, at);
  if (!derived.ok || derived.fingerprint !== request.payloadFingerprint) {
    const ended = writeRequestEnd(ctx, tx, request, { status: "discarded_stale", code: "INPUT_CHANGED" }, at);
    clearPointerIfNamed(ctx, tx, state, request.requestId);
    ledger.release(request.requestId);
    return { kind: "finished", request: ended, replay: false };
  }
  // Unreachable for a request this version claimed (the preference is part of
  // the fingerprint), and refused all the same before any paid work.
  requireSupportedDietaryPreference(profile);

  // The same logical request keeps its one unit: the hold is renewed for the
  // new lease, in the month it was taken — never a second unit, never next
  // month's. Only a request that holds nothing any more needs the allowance.
  const renewed = ledger.reserve({
    requestId: request.requestId,
    limit: DEFAULT_QUOTA_LIMITS[NUTRITION_GENERATION_QUOTA_ACTION],
    expiresAt: operationLeaseExpiry(at, work.setup.operationLeaseMs),
    renew: true,
  });
  if (renewed === null) throw new NutritionGenerationError("QUOTA_EXCEEDED", "The monthly Nutrition generation allowance is used up.");

  // A new owner of the same request: new token, same reserved plan id, same document.
  ctx.records.writeClaim(tx, {
    uid: ctx.uid,
    requestId: request.requestId,
    previous: record,
    at,
    claimToken,
    planId: record.planId,
    leaseMs: work.setup.operationLeaseMs,
  });
  return {
    kind: "claimed",
    request,
    input: derived.input,
    target,
    claimToken,
    planId: record.planId,
    takeover: true,
    ...work,
  };
};

/* ------------------------------------------------------------------ *
 * Finalize and fail
 * ------------------------------------------------------------------ */

export type NutritionGenerationFinish =
  /** This invocation ended the request: succeeded, or discarded_stale. */
  | { kind: "finished"; request: GenerationRequest }
  /** The request is no longer this invocation's to end. Nothing was written. */
  | { kind: "lost"; request: GenerationRequest };

/** Whether `record` still proves this invocation owns the running `request`. */
const owns = (request: GenerationRequest, record: OperationRecord, claimToken: string): boolean =>
  request.status === "running" && record.status === "in_progress" && record.claimToken === claimToken;

const readOwned = async (
  ctx: NutritionGenerationContext,
  tx: ActivationTransaction,
  requestId: string,
  at: Date
): Promise<{ request: GenerationRequest; record: OperationRecord }> => {
  const request = parseGenerationRequest(await tx.get(refsFor(ctx.firestore, ctx.uid).generation(requestId)), requestId);
  if (!request) throw internal("The generation request does not exist.");
  return { request, record: await ctx.records.read(tx, ctx.uid, requestId, at) };
};

/**
 * Commit an accepted candidate: ONE transaction. Only while this invocation's
 * claim is still its own and live; then, if the account still names this
 * request, its base plan is still active and its target still current, the
 * NUT-09 activation core creates the plan, supersedes the base and moves the
 * state (clearing the pointer in the same write), and the request and its
 * record complete with it. If the account moved on — or, by the profile this
 * transaction reads, is no longer an eligible adult — the request is
 * discarded_stale and no plan, slot head, entry or target is touched.
 *
 * An activation refusal (a policy that changed and now rejects) throws and
 * writes nothing; the caller ends the request as failed.
 */
export const finalizeNutritionGeneration = (
  ctx: NutritionGenerationContext,
  { requestId, claimToken, activation, at }: { requestId: string; claimToken: string; activation: PreparedNutritionPlanActivation; at: Date }
): Promise<NutritionGenerationFinish> =>
  runTransaction(ctx.firestore, async (tx): Promise<NutritionGenerationFinish> => {
    const { request, record } = await readOwned(ctx, tx, requestId, at);
    // Past its lease this claim may already belong to a successor's takeover.
    if (!owns(request, record, claimToken) || !record.leaseLive) return { kind: "lost", request };
    if (activation.input.planId !== record.planId || activation.input.completesGenerationRequestId !== requestId) {
      throw internal("The activation is not this request's.");
    }

    const state = parseNutritionStateSnapshot(await tx.get(refsFor(ctx.firestore, ctx.uid).state));
    const profile = await readProfile(ctx, tx);
    // Read before the activation core runs: its own reads come next, and every
    // write — the plan's, the state's, the quota's — after all of them.
    const ledger = await readQuotaLedger(ctx, tx, request);
    const stale = staleCodeFor(state, request, profile);
    if (stale) {
      const ended = writeRequestEnd(ctx, tx, request, { status: "discarded_stale", code: stale }, at);
      clearPointerIfNamed(ctx, tx, state, requestId);
      ledger.release(requestId);
      return { kind: "finished", request: ended };
    }

    const activated = await activateNutritionPlanInTransaction(tx, { firestore: ctx.firestore, policies: ctx.policies }, activation);
    if (activated.kind !== "activated") throw internal("A generation activation cannot be a replay.");
    // The plan and its charge commit together, or neither does.
    ledger.consume(requestId);

    const succeeded: GenerationRequest = {
      ...request,
      status: "succeeded",
      resultPlanId: activated.planId,
      finishedAt: structural(at),
    };
    try {
      assertGenerationRequestTransition(request, succeeded);
    } catch {
      throw internal("The request cannot succeed this way.");
    }
    tx.update(refsFor(ctx.firestore, ctx.uid).generation(requestId), {
      status: "succeeded",
      resultPlanId: activated.planId,
      finishedAt: Timestamp.fromDate(at),
    });
    ctx.records.writeCompleted(tx, { uid: ctx.uid, requestId, at, planId: activated.planId });
    return { kind: "finished", request: succeeded };
  });

/**
 * End the request as failed with a stable code, while this invocation's claim
 * is still its own. No plan is written and the active plan is untouched; the
 * pointer is cleared only if it still names this request.
 */
export const failNutritionGeneration = (
  ctx: NutritionGenerationContext,
  { requestId, claimToken, code, at }: { requestId: string; claimToken: string; code: NutritionGenerationFailureCode; at: Date }
): Promise<NutritionGenerationFinish> =>
  runTransaction(ctx.firestore, async (tx): Promise<NutritionGenerationFinish> => {
    const { request, record } = await readOwned(ctx, tx, requestId, at);
    if (!owns(request, record, claimToken)) return { kind: "lost", request };
    const state = parseNutritionStateSnapshot(await tx.get(refsFor(ctx.firestore, ctx.uid).state));
    const ledger = await readQuotaLedger(ctx, tx, request);
    const ended = writeRequestEnd(ctx, tx, request, { status: "failed", code }, at);
    clearPointerIfNamed(ctx, tx, state, requestId);
    // No plan: the unit goes back. A second release finds no hold and gives nothing.
    ledger.release(requestId);
    return { kind: "finished", request: ended };
  });

/** The code an activation refusal ends a request with. */
export const failureCodeForActivationError = (error: unknown): NutritionGenerationFailureCode =>
  error instanceof NutritionPlanError && error.code === "PLAN_VALIDATION_FAILED" ? "PLAN_VALIDATION_FAILED" : "INTERNAL";
