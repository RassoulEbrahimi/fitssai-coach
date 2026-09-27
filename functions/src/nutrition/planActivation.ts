import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  assertNutritionPlanContentStructure,
  assertNutritionPlanStructure,
  isNutritionDocId,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  supersedeNutritionPlan,
  targetVersionSchema,
  type NutritionPlan,
  type NutritionPlanContent,
  type NutritionStateRequest,
  type NutritionUserState,
  type PlanValidationProvenance,
  type TargetVersion,
} from "../../../shared/nutrition";
import { NutritionPlanError } from "./errors";
import { decidePlanValidation } from "./planValidation/decide";
import type { PlanValidationPolicyRegistry } from "./planValidation/types";
import { appendNutritionStateRequest } from "./stateLedger";

/**
 * The one way a Nutrition V2 base plan becomes the account's active plan.
 * NUT-09 repeat uses it through `activateNutritionPlan`, which owns its
 * transaction; NUT-11 generation finalisation runs the same core,
 * `activateNutritionPlanInTransaction`, inside the transaction that also ends
 * its generation request and operation record. There is no second activation
 * algorithm and no nested transaction.
 *
 * Before the transaction, from the input alone:
 *   - the ids and origin are well-formed, and the plan id is not the expected
 *     active plan's;
 *   - the candidate content passes the structural rules. Content that fails
 *     never reaches a policy and never opens a transaction.
 *
 * Then ONE transaction, which reads everything it decides on and writes all or
 * nothing:
 *   1. re-read and strict-parse the account state;
 *   2. an already-applied request id answers with the plan it created;
 *   3. the active plan is still the one the caller built on
 *      (else STALE_ACTIVE_PLAN), and the current target is still the plan's
 *      target (else STALE_TARGET) — never last-write-wins;
 *   4. read and strict-parse that target version;
 *   5. read and strict-parse the old active plan, if any: stored under its own
 *      id, and active;
 *   6. validation: the policy in force accepts the candidate for the target,
 *      or an acceptance by exactly that policy version is reused;
 *   7. the new plan: active, structurally valid, created with `tx.create` —
 *      never set, merge or overwrite;
 *   8. the old plan, if any: its one lifecycle transition to superseded,
 *      checked by `assertPlanTransition`, written as the lifecycle field only;
 *   9. the state: `activePlanId` = the new plan, `revision` + 1, the target
 *      pointer kept, the request recorded in the ledger; the generation
 *      pointer kept — or, when the activation completes that generation
 *      request, required to name it and cleared in the same write.
 *
 * The plan id and the instant are fixed by the caller before the transaction,
 * so a transaction retry writes exactly what the first attempt would have.
 */

/** Where the plan came from, as it is persisted. */
export type NutritionPlanOrigin =
  | { source: "generated"; generationRequestId: string | null }
  | { source: "repeated"; repeatedFromPlanId: string };

/** A request recorded in the state ledger by this activation. */
export interface NutritionPlanActivationRequest {
  requestId: string;
  operation: "repeatPlan";
}

export interface NutritionPlanActivationInput {
  uid: string;
  /** Minted once by the caller, before the transaction. Never a browser's id. */
  planId: string;
  content: NutritionPlanContent;
  origin: NutritionPlanOrigin;
  /** The target the plan is for. It must still be the account's current target. */
  targetVersionId: string;
  /** The active plan the caller built on (null: none). It must still be active. */
  expectedActivePlanId: string | null;
  /** An earlier acceptance the caller may reuse; see `decidePlanValidation`. */
  reusableValidation: PlanValidationProvenance | null;
  /** Recorded in the ledger; an id already recorded is answered as a replay. */
  request: NutritionPlanActivationRequest | null;
  /** The server instant of creation and activation. */
  now: Date;
  /**
   * The generation request this activation completes (NUT-11), or null. The
   * state must still name it as the active generation, and the same state
   * write clears it: one state change, one revision.
   */
  completesGenerationRequestId?: string | null;
}

export interface NutritionPlanActivationDeps {
  firestore: Firestore;
  policies: PlanValidationPolicyRegistry;
}

export type NutritionPlanActivationResult =
  | {
      kind: "activated";
      planId: string;
      /** The plan this one superseded, if there was an active plan. */
      supersededPlanId: string | null;
      /** The state revision this activation produced. */
      revision: number;
    }
  /** The request id was applied before: nothing was written. */
  | { kind: "replay"; planId: string };

type Snapshot = { exists: boolean; data(): Record<string, unknown> | undefined };

/** The slice of an Admin transaction this module uses. */
export interface ActivationTransaction {
  get(ref: unknown): Promise<Snapshot>;
  set(ref: unknown, data: Record<string, unknown>): void;
  create(ref: unknown, data: Record<string, unknown>): void;
  update(ref: unknown, data: Record<string, unknown>): void;
}

const internal = (message: string) => new NutritionPlanError("INTERNAL", message);

/* ------------------------------------------------------------------ *
 * Strict readers
 * ------------------------------------------------------------------ */

/** A stored state that is not a valid V2 state is an integrity failure, never "none". */
export const parseNutritionStateSnapshot = (snapshot: Snapshot): NutritionUserState | null => {
  if (!snapshot.exists) return null;
  const parsed = nutritionUserStateSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("The Nutrition state document is malformed.");
  return parsed.data;
};

/** The plan stored under `planId`: present, valid, and naming itself. */
export const requireStoredPlan = (snapshot: Snapshot, planId: string): NutritionPlan => {
  if (!snapshot.exists) throw internal("A referenced plan does not exist.");
  const parsed = nutritionPlanSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A referenced plan is malformed.");
  if (parsed.data.planId !== planId) throw internal("A plan is stored under another plan's id.");
  return parsed.data;
};

/** The target version stored under `targetVersionId`: present, valid, and naming itself. */
export const requireStoredTarget = (snapshot: Snapshot, targetVersionId: string): TargetVersion => {
  if (!snapshot.exists) throw internal("A referenced target does not exist.");
  const parsed = targetVersionSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A referenced target is malformed.");
  if (parsed.data.targetVersionId !== targetVersionId) throw internal("A target is stored under another target's id.");
  return parsed.data;
};

/**
 * The `repeatPlan` record of an applied request id, or null when it was never
 * applied. The same id applied by another operation is not the same request.
 */
export const findAppliedRepeatPlan = (
  state: NutritionUserState | null,
  requestId: string
): Extract<NutritionStateRequest, { operation: "repeatPlan" }> | null => {
  const applied = state?.recentRequests.find((request) => request.requestId === requestId);
  if (!applied) return null;
  if (applied.operation !== "repeatPlan") {
    throw new NutritionPlanError("INVALID_REQUEST", "The request id was used for another operation.");
  }
  return applied;
};

/* ------------------------------------------------------------------ *
 * The transition
 * ------------------------------------------------------------------ */

const toStructuralTimestamp = (timestamp: Timestamp) => ({ seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds });

const checkInput = (input: NutritionPlanActivationInput): NutritionPlanContent => {
  const ids = [input.planId, input.targetVersionId];
  if (input.expectedActivePlanId !== null) ids.push(input.expectedActivePlanId);
  const completes = input.completesGenerationRequestId ?? null;
  if (completes !== null) {
    ids.push(completes);
    if (input.origin.source !== "generated" || input.origin.generationRequestId !== completes) {
      throw internal("Only the plan a generation request produced completes it.");
    }
  }
  if (!ids.every(isNutritionDocId) || typeof input.uid !== "string" || input.uid === "") {
    throw internal("The activation input is malformed.");
  }
  if (input.planId === input.expectedActivePlanId) throw internal("A plan cannot supersede itself.");
  if (input.origin.source === "repeated" && !isNutritionDocId(input.origin.repeatedFromPlanId)) {
    throw internal("A repeated plan needs the plan it repeats.");
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) throw internal("The activation instant is invalid.");
  try {
    return assertNutritionPlanContentStructure(input.content);
  } catch {
    throw internal("The plan candidate is not structurally valid.");
  }
};

/** An activation input that has passed the checks that need no transaction. */
export interface PreparedNutritionPlanActivation {
  readonly input: NutritionPlanActivationInput;
  readonly content: NutritionPlanContent;
}

/**
 * The checks that need no transaction: ids, origin, instant, and the
 * candidate's structure. Content that fails never reaches a policy and never
 * opens a transaction.
 */
export const prepareNutritionPlanActivation = (input: NutritionPlanActivationInput): PreparedNutritionPlanActivation => ({
  input,
  content: checkInput(input),
});

/**
 * Steps 1–9 inside a transaction the caller owns. Every read happens before
 * the first write, so a caller may read its own documents first and write its
 * own after this returns, in the same transaction. Throws a
 * `NutritionPlanError` (or the transaction's own failure) and then writes
 * nothing; the caller's transaction is abandoned with it.
 */
export const activateNutritionPlanInTransaction = async (
  tx: ActivationTransaction,
  deps: NutritionPlanActivationDeps,
  { input, content }: PreparedNutritionPlanActivation
): Promise<NutritionPlanActivationResult> => {
  const { planId, targetVersionId, expectedActivePlanId, request } = input;
  const completesGenerationRequestId = input.completesGenerationRequestId ?? null;
  const at = Timestamp.fromDate(input.now);

  const userRef = deps.firestore.collection("users").doc(input.uid);
  const stateRef = userRef.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID);
  const planRef = (id: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.plans).doc(id);
  const targetRef = userRef.collection(NUTRITION_V2_COLLECTIONS.targets).doc(targetVersionId);

  // 1. The state as it is now.
  const state = parseNutritionStateSnapshot(await tx.get(stateRef));

  // 2. An applied request answers with the plan it created, and writes nothing.
  const applied = request ? findAppliedRepeatPlan(state, request.requestId) : null;
  if (applied) {
    requireStoredPlan(await tx.get(planRef(applied.resultPlanId)), applied.resultPlanId);
    return { kind: "replay", planId: applied.resultPlanId };
  }

  // 3. The caller's assumptions still hold, or nothing is written.
  if ((state?.activePlanId ?? null) !== expectedActivePlanId) {
    throw new NutritionPlanError("STALE_ACTIVE_PLAN", "Another plan was activated meanwhile.");
  }
  if (!state || state.currentTargetVersionId !== targetVersionId) {
    throw new NutritionPlanError("STALE_TARGET", "The current target changed meanwhile.");
  }
  // A generation's plan is activated only while the account still names that generation.
  if (completesGenerationRequestId !== null && state.activeGenerationRequestId !== completesGenerationRequestId) {
    throw internal("The state no longer names the generation this plan completes.");
  }

  // 4. The target the plan is for.
  const target = requireStoredTarget(await tx.get(targetRef), targetVersionId);

  // 5. The plan it replaces, if any.
  let previous: NutritionPlan | null = null;
  if (state.activePlanId !== null) {
    previous = requireStoredPlan(await tx.get(planRef(state.activePlanId)), state.activePlanId);
    if (previous.lifecycle.status !== "active") {
      throw new NutritionPlanError("PLAN_NOT_ACTIVE", "The state points to a plan that is not active.");
    }
  }

  // 6. Validation: the policy in force, or its own earlier acceptance.
  const validation = decidePlanValidation({
    policy: deps.policies.current(),
    plan: content,
    target,
    reusable: input.reusableValidation,
  });

  // 7. The new plan, complete and structurally valid before anything is written.
  const plan: NutritionPlan = {
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    planId,
    ...content,
    targetVersionId,
    source: input.origin.source,
    repeatedFromPlanId: input.origin.source === "repeated" ? input.origin.repeatedFromPlanId : null,
    generationRequestId: input.origin.source === "generated" ? input.origin.generationRequestId : null,
    validation,
    createdAt: toStructuralTimestamp(at),
    activatedAt: toStructuralTimestamp(at),
    lifecycle: { status: "active", effectiveUntil: null, supersededByPlanId: null },
  };
  try {
    assertNutritionPlanStructure(plan);
  } catch {
    throw internal("The new plan is not a valid NutritionPlan.");
  }

  // 8. The old plan's one transition. Content is checked unchanged.
  let superseded: NutritionPlan | null = null;
  if (previous) {
    try {
      superseded = supersedeNutritionPlan(previous, { planId, startDate: plan.startDate });
    } catch {
      throw internal("The previous plan cannot be superseded by this plan.");
    }
  }

  // 9. The state: one revision, one pointer, one ledger record.
  const nextState: NutritionUserState = {
    ...state,
    revision: state.revision + 1,
    activePlanId: planId,
    activeGenerationRequestId: completesGenerationRequestId !== null ? null : state.activeGenerationRequestId,
    recentRequests: request
      ? appendNutritionStateRequest(state.recentRequests, {
          requestId: request.requestId,
          operation: request.operation,
          resultPlanId: planId,
        })
      : state.recentRequests,
  };
  if (!nutritionUserStateSchema.safeParse(nextState).success) {
    throw internal("The next state is not a valid NutritionUserState.");
  }

  // All or nothing. `create`: an existing plan is never overwritten.
  tx.create(planRef(planId), { ...plan, createdAt: at, activatedAt: at });
  if (previous && superseded) {
    // Only the lifecycle field: the stored content and timestamps stay as they are.
    tx.update(planRef(previous.planId), { lifecycle: superseded.lifecycle });
  }
  tx.set(stateRef, nextState);

  return { kind: "activated", planId, supersededPlanId: previous?.planId ?? null, revision: nextState.revision };
};

export const activateNutritionPlan = async (
  deps: NutritionPlanActivationDeps,
  input: NutritionPlanActivationInput
): Promise<NutritionPlanActivationResult> => {
  // Structure first: a candidate that fails it never reaches a policy or a transaction.
  const prepared = prepareNutritionPlanActivation(input);

  try {
    return await (
      deps.firestore as unknown as {
        runTransaction: <T>(body: (tx: ActivationTransaction) => Promise<T>) => Promise<T>;
      }
    ).runTransaction((tx) => activateNutritionPlanInTransaction(tx, deps, prepared));
  } catch (error) {
    if (error instanceof NutritionPlanError) throw error;
    throw internal("Failed to activate the plan.");
  }
};
