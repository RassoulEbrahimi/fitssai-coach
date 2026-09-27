import { randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_V2_COLLECTIONS,
  baseMealFor,
  gateSlotHeadRequest,
  getNutritionEligibility,
  isActiveRecordedEntry,
  nutritionDateAt,
  nutritionPlanSchema,
  nutritionUpdateSlotRequestSchema,
  parseNutritionProfile,
  planMealReplacementCandidates,
  planOwnsDate,
  planSlotHeadCommit,
  planSlotHeadUndo,
  recordedEntrySchema,
  replacementSuggestionSetSchema,
  slotEntryId,
  slotHeadId,
  slotHeadMatchesPlan,
  slotHeadSchema,
  type MealOverrideOrigin,
  type NutritionPlan,
  type NutritionTimestamp,
  type NutritionUpdateSlotRequest,
  type NutritionUpdateSlotResult,
  type PlannedMeal,
  type ReplacementSuggestionSet,
  type SlotHead,
  type SlotHeadPlan,
} from "../../../shared/nutrition";
import { requireAuth, type AuthContextLike } from "../auth";
import { NutritionSlotError } from "./errors";
import { suggestionSetRef } from "./suggestionStore";

/**
 * `nutritionUpdateSlot` (NUT-10): commit one replacement of one slot's PLANNED
 * meal, or undo the selected one. The base NutritionPlan, the TARGET and every
 * RecordedEntry stay exactly as they are; the only document that changes is
 * the slot head (and, for a suggestion, that candidate's consumption).
 *
 * Before the transaction, from the request and the server alone:
 *   1. the verified caller (never a uid from the request)
 *   2. the request: one of the strict shapes — ids only, never meal content
 *   3. the date is today or later in Berlin, by the server clock (DATE_FROZEN)
 *   4. the override id, and a planMeal copy's meal id, minted once — so a
 *      transaction retry writes what the first attempt would have
 *
 * Then ONE transaction, all reads before any write:
 *   5. the caller's own profile, and NUT-03 adult eligibility from it
 *      (NOT_ELIGIBLE). It is a transaction read, so an age change that commits
 *      meanwhile makes Firestore retry the transaction, and the retry judges
 *      the new profile: an account that stopped being eligible never has its
 *      slots extended. There is no second, earlier eligibility check.
 *   6. the plan that OWNS the date, by the NUT-09 rule: the latest plan with
 *      `startDate <= date` that `planOwnsDate`. It must be the plan named —
 *      not necessarily `state.activePlanId`, which may be a successor that
 *      starts later (PLAN_CHANGED_FOR_DATE)
 *   7. the slot is configured (SLOT_NOT_CONFIGURED); its base meal exists
 *   8. the head: absent is base at revision 0; present is strict, of this
 *      slot, and consistent with the plan
 *   9. an already-applied request id answers with the head as it is — before
 *      the revision is compared, before anything else is checked, no write
 *  10. `expectedRevision` is the head's revision (STALE_REVISION) — never
 *      last-write-wins, never rebased
 *  11. the slot's RecordedEntry: an active one blocks (SLOT_HAS_RECORD); a
 *      tombstone or none does not. It is read, never written.
 *  12. commit: the replacement is resolved from server data only — another
 *      base meal of the owning plan, or an unexpired, unconsumed candidate of
 *      the server-held suggestion set bound to exactly this slot
 *      undo: the selected override must exist (NOTHING_TO_UNDO)
 *  13. the head is created (revision 0) or replaced with its next revision;
 *      a suggestion candidate is marked consumed in the same transaction
 */

export interface NutritionUpdateSlotDeps {
  firestore: Firestore;
  now?: () => Date;
  /** Mints the override id and a planMeal copy's meal id. Server-side only. */
  newId?: () => string;
}

export interface NutritionUpdateSlotCallRequest extends AuthContextLike {
  data?: unknown;
}

type DocSnapshot = { exists: boolean; data(): Record<string, unknown> | undefined };
type QuerySnapshot = { docs: Array<{ id: string; data(): Record<string, unknown> }> };

/** The slice of an Admin transaction this module uses. */
interface SlotTransaction {
  get(ref: unknown): Promise<unknown>;
  create(ref: unknown, data: Record<string, unknown>): void;
  set(ref: unknown, data: Record<string, unknown>): void;
  update(ref: unknown, data: Record<string, unknown>): void;
}

const refuse = (code: NutritionSlotError["code"], message: string) => new NutritionSlotError(code, message);
const internal = (message: string) => refuse("INTERNAL", message);

const compareTimestamps = (a: NutritionTimestamp, b: NutritionTimestamp): number =>
  a.seconds !== b.seconds ? a.seconds - b.seconds : a.nanoseconds - b.nanoseconds;

/* ------------------------------------------------------------------ *
 * Strict readers
 * ------------------------------------------------------------------ */

/** The plan that owns `date`, from the candidate query; null when none does. */
const parseOwningPlan = (snapshot: QuerySnapshot, date: string): NutritionPlan | null => {
  if (snapshot.docs.length > 1) throw internal("More than one candidate plan was returned.");
  const [candidate] = snapshot.docs;
  if (!candidate) return null;
  const parsed = nutritionPlanSchema.safeParse(candidate.data());
  if (!parsed.success) throw internal("A plan is malformed.");
  const plan = parsed.data;
  if (plan.planId !== candidate.id) throw internal("A plan is stored under another plan's id.");
  if (plan.startDate > date) throw internal("The candidate plan starts after the date.");
  return planOwnsDate(plan, date) ? plan : null;
};

/** The head of exactly this slot, strict and consistent with its plan; null when there is none. */
const parseHead = (snapshot: DocSnapshot, plan: NutritionPlan, request: NutritionUpdateSlotRequest): SlotHead | null => {
  if (!snapshot.exists) return null;
  const parsed = slotHeadSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A slot head is malformed.");
  const head = parsed.data;
  if (head.planId !== request.planId || head.date !== request.date || head.slotId !== request.slotId) {
    throw internal("A slot head is stored under another slot's id.");
  }
  if (!slotHeadMatchesPlan(head, plan)) throw internal("A slot head does not match its plan.");
  return head;
};

/** Whether the slot has an active recording. A tombstone or no entry is none. */
const hasActiveRecord = (snapshot: DocSnapshot, entryId: string): boolean => {
  if (!snapshot.exists) return false;
  const parsed = recordedEntrySchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A recorded entry is malformed.");
  if (parsed.data.entryId !== entryId) throw internal("A recorded entry is stored under another id.");
  return isActiveRecordedEntry(parsed.data);
};

/* ------------------------------------------------------------------ *
 * Replacement sources
 * ------------------------------------------------------------------ */

interface ResolvedReplacement {
  meal: PlannedMeal;
  source: MealOverrideOrigin;
  /** The suggestion set to mark, for a suggestion. */
  consume: { ref: unknown; set: ReplacementSuggestionSet; candidateId: string } | null;
}

/** A copy of another BASE meal of the owning plan, for the same slot, under a new server meal id. */
const resolvePlanMeal = (
  plan: NutritionPlan,
  request: NutritionUpdateSlotRequest,
  sourceMealId: string,
  mealId: string
): ResolvedReplacement => {
  const source = planMealReplacementCandidates(plan, request.date, request.slotId).find(
    (meal) => meal.mealId === sourceMealId
  );
  if (!source) {
    throw refuse("INVALID_SOURCE_MEAL", "The source is not another base meal of this plan for the slot.");
  }
  return {
    meal: {
      mealId,
      slotId: request.slotId,
      name: source.name,
      values: {
        kcal: source.values.kcal,
        proteinG: source.values.proteinG,
        carbsG: source.values.carbsG,
        fatG: source.values.fatG,
      },
    },
    source: { kind: "planMeal", sourceMealId: source.mealId },
    consume: null,
  };
};

/** The chosen candidate of a server-held set bound to exactly this slot. */
const resolveSuggestion = (
  snapshot: DocSnapshot,
  ref: unknown,
  uid: string,
  request: NutritionUpdateSlotRequest,
  replacement: { suggestionSetId: string; candidateId: string },
  now: NutritionTimestamp
): ResolvedReplacement => {
  if (!snapshot.exists) throw refuse("SUGGESTION_NOT_FOUND", "No such suggestion set.");
  const parsed = replacementSuggestionSetSchema.safeParse(snapshot.data());
  if (!parsed.success) throw internal("A suggestion set is malformed.");
  const set = parsed.data;
  // Another account's set, or one for another slot, is not this slot's suggestion.
  if (
    set.ownerUid !== uid ||
    set.suggestionSetId !== replacement.suggestionSetId ||
    set.planId !== request.planId ||
    set.date !== request.date ||
    set.slotId !== request.slotId
  ) {
    throw refuse("SUGGESTION_NOT_FOUND", "No such suggestion set for this slot.");
  }
  if (compareTimestamps(set.expiresAt, now) <= 0) throw refuse("SUGGESTION_EXPIRED", "The suggestion set has expired.");
  const candidate = set.candidates.find((entry) => entry.candidateId === replacement.candidateId);
  if (!candidate) throw refuse("CANDIDATE_NOT_FOUND", "No such candidate.");
  if (candidate.consumedByRequestId !== null) {
    throw refuse("SUGGESTION_ALREADY_CONSUMED", "The candidate was committed by another request.");
  }
  return {
    meal: {
      mealId: candidate.meal.mealId,
      slotId: candidate.meal.slotId,
      name: candidate.meal.name,
      values: { ...candidate.meal.values },
    },
    source: {
      kind: "aiSuggestion",
      suggestionSetId: set.suggestionSetId,
      candidateId: candidate.candidateId,
      validation: { policy: { ...set.validation.policy }, outcome: set.validation.outcome },
    },
    consume: { ref, set, candidateId: candidate.candidateId },
  };
};

/* ------------------------------------------------------------------ *
 * Stored shapes
 * ------------------------------------------------------------------ */

const toAdmin = (timestamp: NutritionTimestamp) => new Timestamp(timestamp.seconds, timestamp.nanoseconds);

/** The head as Firestore stores it: every instant an Admin `Timestamp`. */
const toStoredHead = (head: SlotHead): Record<string, unknown> => ({
  ...head,
  overrides: Object.fromEntries(
    Object.entries(head.overrides).map(([id, override]) => [id, { ...override, createdAt: toAdmin(override.createdAt) }])
  ),
  updatedAt: toAdmin(head.updatedAt),
});

const answer = (head: SlotHead, replay: boolean): NutritionUpdateSlotResult => ({
  ok: true,
  planId: head.planId,
  date: head.date,
  slotId: head.slotId,
  revision: head.revision,
  selection: head.selection.kind === "override" ? { kind: "override", overrideId: head.selection.overrideId } : { kind: "base" },
  replay,
});

/* ------------------------------------------------------------------ *
 * The handler
 * ------------------------------------------------------------------ */

export const handleNutritionUpdateSlot = async (
  call: NutritionUpdateSlotCallRequest,
  deps: NutritionUpdateSlotDeps
): Promise<NutritionUpdateSlotResult> => {
  // 1. Identity from the verified token only.
  const { uid } = requireAuth(call);

  // 2. One strict shape. Anything else is refused, not ignored.
  const parsed = nutritionUpdateSlotRequestSchema.safeParse(call.data);
  if (!parsed.success) throw refuse("INVALID_REQUEST", "Expected a slot commit or undo.");
  const request = parsed.data;

  const userRef = deps.firestore.collection("users").doc(uid);

  // 3. Today or later, by the server's Berlin day. Yesterday is frozen.
  const at = (deps.now ?? (() => new Date()))();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw internal("The server instant is invalid.");
  if (request.date < nutritionDateAt(at)) throw refuse("DATE_FROZEN", "Past dates cannot be changed.");
  const now = { seconds: Timestamp.fromDate(at).seconds, nanoseconds: Timestamp.fromDate(at).nanoseconds };

  // 4. Minted once, reused by every attempt of the transaction.
  const newId = deps.newId ?? randomUUID;
  const overrideId = request.action === "commit" ? newId() : null;
  const planMealId =
    request.action === "commit" && request.replacement.source === "planMeal" ? newId() : null;

  const plansQuery = userRef
    .collection(NUTRITION_V2_COLLECTIONS.plans)
    .where("startDate", "<=", request.date)
    .orderBy("startDate", "desc")
    .limit(1);
  const headRef = userRef
    .collection(NUTRITION_V2_COLLECTIONS.slots)
    .doc(slotHeadId(request.planId, request.date, request.slotId));
  const entryId = slotEntryId(request.date, request.slotId);
  const entryRef = userRef.collection(NUTRITION_V2_COLLECTIONS.entries).doc(entryId);

  try {
    return await (
      deps.firestore as unknown as {
        runTransaction: <T>(body: (tx: SlotTransaction) => Promise<T>) => Promise<T>;
      }
    ).runTransaction(async (tx): Promise<NutritionUpdateSlotResult> => {
      // 5. Adults only, by the NUT-03 rule, judged on the profile as this
      //    attempt reads it. The age itself is never reported.
      const eligibility = getNutritionEligibility(
        parseNutritionProfile(((await tx.get(userRef)) as DocSnapshot).data())
      );
      if (!eligibility.eligible) {
        throw new NutritionSlotError("NOT_ELIGIBLE", "Nutrition is for adults with a known age.", {
          reason: eligibility.reason,
        });
      }

      // 6. The plan that owns the date now — never a stale or a later plan.
      const plan = parseOwningPlan((await tx.get(plansQuery)) as QuerySnapshot, request.date);
      if (plan === null || plan.planId !== request.planId) {
        throw refuse("PLAN_CHANGED_FOR_DATE", "The plan does not own the date.");
      }

      // 7. A configured slot with its base meal.
      if (!plan.slotOrder.includes(request.slotId)) throw refuse("SLOT_NOT_CONFIGURED", "The plan has no such slot.");
      const baseMeal = baseMealFor(plan, request.date, request.slotId);
      if (!baseMeal) throw internal("The plan has no base meal for the slot.");

      // 8–10. The head; an applied request first, then compare-and-set.
      const head = parseHead((await tx.get(headRef)) as DocSnapshot, plan, request);
      const gated = gateSlotHeadRequest(head, request);
      if (gated?.outcome === "alreadyApplied") return answer(gated.head, true);
      if (gated?.outcome === "staleRevision") {
        throw new NutritionSlotError("STALE_REVISION", "The slot was changed meanwhile.", {
          currentRevision: gated.currentRevision,
        });
      }

      // 11. A recorded slot keeps its planned meal. The entry is only read.
      if (hasActiveRecord((await tx.get(entryRef)) as DocSnapshot, entryId)) {
        throw refuse("SLOT_HAS_RECORD", "The slot has a recorded entry.");
      }

      // 12. What the request does.
      let plannedHead: SlotHeadPlan;
      let consume: ResolvedReplacement["consume"] = null;
      if (request.action === "commit") {
        const { replacement } = request;
        let resolved: ResolvedReplacement;
        if (replacement.source === "planMeal") {
          resolved = resolvePlanMeal(plan, request, replacement.sourceMealId, planMealId as string);
        } else {
          const ref = suggestionSetRef(deps.firestore, uid, replacement.suggestionSetId);
          resolved = resolveSuggestion((await tx.get(ref)) as DocSnapshot, ref, uid, request, replacement, now);
        }
        consume = resolved.consume;
        plannedHead = planSlotHeadCommit(head, {
          planId: request.planId,
          date: request.date,
          slotId: request.slotId,
          requestId: request.requestId,
          expectedRevision: request.expectedRevision,
          now,
          baseMealId: baseMeal.mealId,
          overrideId: overrideId as string,
          meal: resolved.meal,
          source: resolved.source,
        });
      } else {
        plannedHead = planSlotHeadUndo(head, {
          planId: request.planId,
          date: request.date,
          slotId: request.slotId,
          requestId: request.requestId,
          expectedRevision: request.expectedRevision,
          now,
        });
        if (plannedHead.outcome === "nothingToUndo") throw refuse("NOTHING_TO_UNDO", "The slot shows its base meal.");
      }
      // The gate above already answered these; the planner agrees or something is wrong.
      if (plannedHead.outcome !== "apply") throw internal("The slot head changed within the transaction.");
      const next = plannedHead.head;

      // 13. All or nothing. A new head is created, never overwriting one.
      if (head === null) tx.create(headRef, toStoredHead(next));
      else tx.set(headRef, toStoredHead(next));
      if (consume) {
        const { ref, set, candidateId } = consume;
        tx.update(ref, {
          candidates: set.candidates.map((candidate) =>
            candidate.candidateId === candidateId ? { ...candidate, consumedByRequestId: request.requestId } : candidate
          ),
        });
      }
      return answer(next, false);
    });
  } catch (error) {
    if (error instanceof NutritionSlotError) throw error;
    throw internal("Failed to update the slot.");
  }
};
