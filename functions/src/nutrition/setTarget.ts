import { randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_STATE_REQUEST_LEDGER_SIZE,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  computeNutritionTargetFingerprint,
  getNutritionEligibility,
  isNutritionTargetProfileField,
  nutritionDateAt,
  nutritionSetTargetRequestSchema,
  nutritionUserStateSchema,
  nutritionValuesSchema,
  parseNutritionProfile,
  resolveNutritionTargetProfileInputs,
  targetPolicyRefSchema,
  targetVersionSchema,
  type NutritionDate,
  type NutritionSetTargetResult,
  type NutritionStateRequest,
  type NutritionTargetMode,
  type NutritionUserState,
  type NutritionValues,
  type ProfileFingerprint,
  type Sha256Hex,
  type TargetPolicyRef,
  type TargetVersion,
} from "../../../shared/nutrition";
import { requireAuth, type AuthContextLike } from "../auth";
import { NutritionTargetError } from "./errors";
import { nodeSha256Hex } from "./sha256";
import type { TargetPolicyRegistry } from "./targetPolicy/types";

/**
 * `nutritionSetTarget`: create the caller's next TARGET version.
 *
 * The order is fixed, and everything that can refuse runs before anything is
 * written:
 *
 *   1. the verified caller (never a uid from the request)
 *   2. the request: exactly `{ mode, requestId }`
 *   3. the caller's own profile, read here — the browser sends no inputs
 *   4. NUT-03 adult eligibility
 *   5. an already-applied request id answers with what it created
 *   6. the policy for the mode; none → TARGET_POLICY_NOT_CONFIGURED
 *   7. the policy's required profile fields; unanswered → PROFILE_INCOMPLETE
 *   8. the policy's result, validated as canonical NutritionValues
 *   9. the profile fingerprint (hash and field names; no raw values)
 *  10. one transaction: the new immutable TargetVersion and the account state
 *      (pointer, revision, request ledger) commit together or not at all
 *
 * Step 5 comes before the policy on purpose: a retry of a request whose
 * response was lost must get the target it created even if the profile or the
 * policies have changed since. The transaction checks the ledger again, so
 * concurrent duplicates still converge on one target.
 *
 * No provider, no quota, no `_ai_operations` record and no logging: the
 * request ledger in the state document is the only idempotency record, and
 * nothing here writes a profile value anywhere.
 */

export interface NutritionSetTargetDeps {
  firestore: Firestore;
  policies: TargetPolicyRegistry;
  now?: () => Date;
  /** Mints the new target version id. Server-side only; never the request id. */
  newTargetId?: () => string;
  sha256Hex?: Sha256Hex;
}

export interface NutritionSetTargetRequest extends AuthContextLike {
  data?: unknown;
}

/** The slice of an Admin transaction this handler uses. */
interface TargetTransaction {
  get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(ref: unknown, data: Record<string, unknown>): void;
  create(ref: unknown, data: Record<string, unknown>): void;
}

const internal = (message: string) => new NutritionTargetError("INTERNAL", message);

/* ------------------------------------------------------------------ *
 * The state transition
 * ------------------------------------------------------------------ */

/** Appends `request` and evicts the oldest records beyond the ledger size. */
export const appendNutritionStateRequest = (
  ledger: readonly NutritionStateRequest[],
  request: NutritionStateRequest
): NutritionStateRequest[] => [...ledger, request].slice(-NUTRITION_STATE_REQUEST_LEDGER_SIZE);

export interface SetTargetTransitionInput {
  requestId: string;
  targetVersionId: string;
  mode: NutritionTargetMode;
  values: NutritionValues;
  effectiveFrom: NutritionDate;
  policy: TargetPolicyRef;
  profileFingerprint: ProfileFingerprint;
}

export type SetTargetTransition =
  /** The request id was applied before: nothing is written. */
  | { kind: "replay"; targetVersionId: string }
  | { kind: "create"; target: Omit<TargetVersion, "createdAt">; state: NutritionUserState };

/**
 * What one set-target request does to the account state. Pure.
 *
 * A new request moves the revision by exactly one; the new target takes that
 * revision as its `effectiveOrder` and supersedes the previous current target.
 * The plan and generation pointers are carried over untouched. A missing state
 * is created here, at revision 1 — and only here.
 */
export const planSetTargetTransition = (
  state: NutritionUserState | null,
  input: SetTargetTransitionInput
): SetTargetTransition => {
  const applied = state?.recentRequests.find((request) => request.requestId === input.requestId);
  if (applied) return { kind: "replay", targetVersionId: applied.resultTargetVersionId };

  const revision = (state?.revision ?? 0) + 1;
  return {
    kind: "create",
    target: {
      schemaVersion: NUTRITION_SCHEMA_VERSION,
      targetVersionId: input.targetVersionId,
      mode: input.mode,
      values: input.values,
      effectiveFrom: input.effectiveFrom,
      effectiveOrder: revision,
      policy: input.policy,
      profileFingerprint: input.profileFingerprint,
      supersedesTargetVersionId: state?.currentTargetVersionId ?? null,
    },
    state: {
      schemaVersion: NUTRITION_SCHEMA_VERSION,
      revision,
      activePlanId: state?.activePlanId ?? null,
      currentTargetVersionId: input.targetVersionId,
      activeGenerationRequestId: state?.activeGenerationRequestId ?? null,
      recentRequests: appendNutritionStateRequest(state?.recentRequests ?? [], {
        requestId: input.requestId,
        operation: "setTarget",
        resultTargetVersionId: input.targetVersionId,
      }),
    },
  };
};

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

/** A stored state that is not a valid V2 state is an integrity failure, never "none". */
const parseState = (snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }): NutritionUserState | null => {
  if (!snapshot.exists) return null;
  const parsed = nutritionUserStateSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("The Nutrition state document is malformed.");
  return parsed.data;
};

/**
 * The target an applied request created. The ledger naming a target that is
 * missing, malformed or of another mode is an integrity failure: nothing is
 * created in its place under the same request id.
 */
const requireReplayedTarget = (
  snapshot: { exists: boolean; data(): Record<string, unknown> | undefined },
  targetVersionId: string,
  mode: NutritionTargetMode
): NutritionSetTargetResult => {
  if (!snapshot.exists) throw internal("An applied request names a target that does not exist.");
  const parsed = targetVersionSchema.safeParse(snapshot.data());
  if (!parsed.success || parsed.data.targetVersionId !== targetVersionId) {
    throw internal("An applied request names a malformed target.");
  }
  // The same request id for another mode is not the same request.
  if (parsed.data.mode !== mode) throw new NutritionTargetError("INVALID_REQUEST", "The request id was used for another mode.");
  return { ok: true, targetVersionId, replay: true };
};

const toStructuralTimestamp = (timestamp: Timestamp) => ({ seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds });

export const handleNutritionSetTarget = async (
  request: NutritionSetTargetRequest,
  deps: NutritionSetTargetDeps
): Promise<NutritionSetTargetResult> => {
  const now = deps.now ?? (() => new Date());
  const sha256Hex = deps.sha256Hex ?? nodeSha256Hex;

  // 1. Identity from the verified token only.
  const { uid } = requireAuth(request);

  // 2. Exactly `{ mode, requestId }`. Anything else is refused, not ignored.
  const parsedRequest = nutritionSetTargetRequestSchema.safeParse(request.data);
  if (!parsedRequest.success) throw new NutritionTargetError("INVALID_REQUEST", "Expected { mode, requestId }.");
  const { mode, requestId } = parsedRequest.data;

  const userRef = deps.firestore.collection("users").doc(uid);
  const stateRef = userRef.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID);
  const targetRef = (targetVersionId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.targets).doc(targetVersionId);

  // 3. The caller's own profile.
  let profileData: Record<string, unknown> | undefined;
  try {
    profileData = (await userRef.get()).data();
  } catch {
    throw internal("Failed to read the profile.");
  }
  const profile = parseNutritionProfile(profileData);

  // 4. Adults only, by the NUT-03 rule. The age itself is never reported.
  const eligibility = getNutritionEligibility(profile);
  if (!eligibility.eligible) {
    throw new NutritionTargetError("NOT_ELIGIBLE", "Nutrition is for adults with a known age.", {
      reason: eligibility.reason,
    });
  }

  // 5. An applied request answers with what it created, whatever changed since.
  try {
    const known = parseState(await stateRef.get());
    const applied = known?.recentRequests.find((entry) => entry.requestId === requestId);
    if (applied) {
      return requireReplayedTarget(await targetRef(applied.resultTargetVersionId).get(), applied.resultTargetVersionId, mode);
    }
  } catch (error) {
    if (error instanceof NutritionTargetError) throw error;
    throw internal("Failed to read the Nutrition state.");
  }

  // 6. The signed-off policy for the mode. None is configured in production.
  const policy = deps.policies.get(mode);
  if (!policy) throw new NutritionTargetError("TARGET_POLICY_NOT_CONFIGURED", `No target policy for ${mode}.`);
  const policyRef = targetPolicyRefSchema.safeParse({ id: policy.id, version: policy.version });
  if (policy.mode !== mode || !policyRef.success || !policy.requiredProfileFields.every(isNutritionTargetProfileField)) {
    throw internal("The target policy is misconfigured.");
  }

  // 7. Every field the policy reads must be answered. Names only in the error.
  const inputs = resolveNutritionTargetProfileInputs(profile, policy.requiredProfileFields);
  if (inputs.status === "incomplete") {
    throw new NutritionTargetError("PROFILE_INCOMPLETE", "Required profile fields are not answered.", {
      missingFields: inputs.missingFields,
      invalidFields: inputs.invalidFields,
    });
  }

  // 8. The policy sees exactly its fields, frozen, and its answer is checked.
  let output: unknown;
  try {
    output = policy.compute(Object.freeze({ mode, profile: Object.freeze({ ...inputs.values }) }));
  } catch {
    throw internal("The target policy failed.");
  }
  const values = nutritionValuesSchema.safeParse(output);
  if (!values.success) throw internal("The target policy returned invalid values.");

  // 9. What the inputs looked like — hash and names, never the answers.
  const profileFingerprint = await computeNutritionTargetFingerprint(
    { mode, policy: policyRef.data, fields: inputs.fields, values: inputs.values },
    sha256Hex
  );

  // 10. Target and state, atomically. Minted once, so a transaction retry
  //     writes the same id it would have written the first time.
  const at = now();
  const createdAt = Timestamp.fromDate(at);
  const targetVersionId = (deps.newTargetId ?? randomUUID)();
  const effectiveFrom = nutritionDateAt(at);

  try {
    return await (
      deps.firestore as unknown as { runTransaction: <T>(body: (tx: TargetTransaction) => Promise<T>) => Promise<T> }
    ).runTransaction(async (tx) => {
      const state = parseState(await tx.get(stateRef));
      const transition = planSetTargetTransition(state, {
        requestId,
        targetVersionId,
        mode,
        values: values.data,
        effectiveFrom,
        policy: policyRef.data,
        profileFingerprint,
      });

      if (transition.kind === "replay") {
        return requireReplayedTarget(await tx.get(targetRef(transition.targetVersionId)), transition.targetVersionId, mode);
      }

      // Both documents must be valid V2 before either is written.
      const target = { ...transition.target, createdAt };
      if (!targetVersionSchema.safeParse({ ...target, createdAt: toStructuralTimestamp(createdAt) }).success) {
        throw internal("The new target is not a valid TargetVersion.");
      }
      if (!nutritionUserStateSchema.safeParse(transition.state).success) {
        throw internal("The next state is not a valid NutritionUserState.");
      }

      // `create`: an existing target is never overwritten.
      tx.create(targetRef(targetVersionId), target);
      tx.set(stateRef, transition.state);
      return { ok: true as const, targetVersionId, replay: false };
    });
  } catch (error) {
    if (error instanceof NutritionTargetError) throw error;
    throw internal("Failed to store the target.");
  }
};
