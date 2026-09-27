import { z } from "zod";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_SLOT_REQUEST_RING_SIZE,
  mealOverrideSchema,
  nutritionDateSchema,
  nutritionDocIdSchema,
  nutritionRequestIdSchema,
  nutritionSlotIdSchema,
  selectedMealOverride,
  slotHeadRevision,
  slotHeadSchema,
  slotSelectionSchema,
  type MealOverride,
  type MealOverrideOrigin,
  type NutritionPlan,
  type NutritionTimestamp,
  type PlannedMeal,
  type SlotHead,
  type SlotSelection,
} from "./contracts";
import type { NutritionDate } from "./dates";
import type { NutritionSlotId } from "./identity";

/**
 * Nutrition V2 slot overrides (NUT-10): the `nutritionUpdateSlot` callable
 * contract and the pure rules of a slot head, shared by the server and the
 * browser. No Firestore, React, Node or browser API, no clock, no randomness.
 *
 *   planSlotHeadCommit  append one override and select it
 *   planSlotHeadUndo    select the override the selected one followed, or base
 *   slotHeadMatchesPlan a head read against the plan it belongs to
 *   planMealReplacementCandidates  which base meals may replace a slot
 *
 * The base NutritionPlan is never an output of anything here. A slot head is
 * the compare-and-set record of one slot's PLANNED meal; TARGET and RECORDED
 * are neither read nor written.
 */

/* ------------------------------------------------------------------ *
 * The callable contract
 * ------------------------------------------------------------------ */

export const NUTRITION_UPDATE_SLOT_CALLABLE = "nutritionUpdateSlot" as const;

const slotAddress = {
  requestId: nutritionRequestIdSchema,
  planId: nutritionDocIdSchema,
  date: nutritionDateSchema,
  slotId: nutritionSlotIdSchema,
  /** The head revision the person saw; 0 when the slot had no head. */
  expectedRevision: z.number().int("expectedRevision must be a whole number").nonnegative(),
};

/**
 * What a replacement names: ids only. The meal itself is resolved by the
 * server — from the plan's own base content, or from a suggestion set it holds.
 */
export const nutritionSlotReplacementSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("planMeal"), sourceMealId: nutritionDocIdSchema }).strict(),
  z
    .object({ source: z.literal("aiSuggestion"), suggestionSetId: nutritionDocIdSchema, candidateId: nutritionDocIdSchema })
    .strict(),
]);

export type NutritionSlotReplacement = z.infer<typeof nutritionSlotReplacementSchema>;

/**
 * One confirmed action on one slot: commit a replacement, or undo the selected
 * one. Strict: a uid, a meal name, values, a meal object, an override id, a
 * meal id, a head or a profile field in the request is refused, not ignored.
 * Identity comes from the verified auth token.
 */
export const nutritionUpdateSlotRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("commit"), ...slotAddress, replacement: nutritionSlotReplacementSchema }).strict(),
  z.object({ action: z.literal("undo"), ...slotAddress }).strict(),
]);

export type NutritionUpdateSlotRequest = z.infer<typeof nutritionUpdateSlotRequestSchema>;

/**
 * What a successful call answers: the slot's revision and selection after the
 * request. `replay`: the request id had already been applied and nothing was
 * written; the answer is the head as it is now.
 */
export const nutritionUpdateSlotResultSchema = z
  .object({
    ok: z.literal(true),
    planId: nutritionDocIdSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema,
    revision: z.number().int().positive(),
    selection: slotSelectionSchema,
    replay: z.boolean(),
  })
  .strict();

export type NutritionUpdateSlotResult = z.infer<typeof nutritionUpdateSlotResultSchema>;

/**
 * Every failure `nutritionUpdateSlot` can report. Stable codes, never prose:
 *
 *   UNAUTHENTICATED              no verified caller
 *   INVALID_REQUEST              the request is not one of the strict shapes
 *   NOT_ELIGIBLE                 not an adult with a known age (NUT-03)
 *   DATE_FROZEN                  the date is before today (Berlin)
 *   PLAN_CHANGED_FOR_DATE        the plan named does not own the date (now)
 *   SLOT_NOT_CONFIGURED          the plan does not configure the slot
 *   SLOT_HAS_RECORD              the slot has an active recorded entry
 *   STALE_REVISION               the head is not at `expectedRevision`;
 *                                details carry `currentRevision`
 *   NOTHING_TO_UNDO              the slot shows its base meal
 *   INVALID_SOURCE_MEAL          `sourceMealId` is not another base meal of the
 *                                plan for the same slot
 *   SUGGESTION_NOT_FOUND         no such suggestion set for this slot
 *   SUGGESTION_EXPIRED           the set's `expiresAt` has passed
 *   SUGGESTION_ALREADY_CONSUMED  another request committed the candidate
 *   CANDIDATE_NOT_FOUND          the set has no such candidate
 *   INTERNAL                     anything else; nothing internal is exposed
 */
export const NUTRITION_SLOT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "NOT_ELIGIBLE",
  "DATE_FROZEN",
  "PLAN_CHANGED_FOR_DATE",
  "SLOT_NOT_CONFIGURED",
  "SLOT_HAS_RECORD",
  "STALE_REVISION",
  "NOTHING_TO_UNDO",
  "INVALID_SOURCE_MEAL",
  "SUGGESTION_NOT_FOUND",
  "SUGGESTION_EXPIRED",
  "SUGGESTION_ALREADY_CONSUMED",
  "CANDIDATE_NOT_FOUND",
  "INTERNAL",
] as const;

export type NutritionSlotErrorCode = (typeof NUTRITION_SLOT_ERROR_CODES)[number];

export const isNutritionSlotErrorCode = (value: unknown): value is NutritionSlotErrorCode =>
  typeof value === "string" && (NUTRITION_SLOT_ERROR_CODES as readonly string[]).includes(value);

/* ------------------------------------------------------------------ *
 * The base plan side
 * ------------------------------------------------------------------ */

/** The plan's own meal for `slotId` on `date`, or null when it has none. */
export const baseMealFor = (
  plan: Pick<NutritionPlan, "days">,
  date: NutritionDate,
  slotId: NutritionSlotId
): PlannedMeal | null => plan.days.find((day) => day.date === date)?.meals.find((meal) => meal.slotId === slotId) ?? null;

/**
 * The BASE meals of `plan` that may replace `slotId` on `date`: every meal of
 * the plan's own content planned for the same slot, except that date's own
 * base meal (going back to it is Undo). In plan order. Identity is the
 * `mealId`; two meals with the same name are two candidates. Slot-head
 * overrides are never candidates, and no other plan's meal is.
 */
export const planMealReplacementCandidates = (
  plan: Pick<NutritionPlan, "days">,
  date: NutritionDate,
  slotId: NutritionSlotId
): PlannedMeal[] => {
  const base = baseMealFor(plan, date, slotId);
  return plan.days.flatMap((day) =>
    day.meals.filter((meal) => meal.slotId === slotId && meal.mealId !== base?.mealId)
  );
};

/**
 * Whether a head read for `plan` is consistent with it: every override
 * replaces that date's base meal of the slot, and a `planMeal` override names
 * another base meal of the same plan and slot. The head's own structure is the
 * schema's; this is the part only the plan can answer.
 */
export const slotHeadMatchesPlan = (head: SlotHead, plan: Pick<NutritionPlan, "planId" | "days">): boolean => {
  if (head.planId !== plan.planId) return false;
  const base = baseMealFor(plan, head.date, head.slotId);
  if (!base) return false;
  const sources = new Set(planMealReplacementCandidates(plan, head.date, head.slotId).map((meal) => meal.mealId));
  return Object.values(head.overrides).every(
    (override) =>
      override.baseMealId === base.mealId &&
      (override.source.kind !== "planMeal" || sources.has(override.source.sourceMealId))
  );
};

/* ------------------------------------------------------------------ *
 * Head transitions
 * ------------------------------------------------------------------ */

/** The ring after applying `requestId`: appended, then the oldest dropped down to the ring size. */
export const appendSlotRequestId = (ring: readonly string[], requestId: string): string[] =>
  [...ring, requestId].slice(-NUTRITION_SLOT_REQUEST_RING_SIZE);

export interface SlotHeadAddress {
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
}

interface SlotHeadRequest extends SlotHeadAddress {
  requestId: string;
  expectedRevision: number;
  /** The server instant the request is applied at. */
  now: NutritionTimestamp;
}

export interface SlotHeadCommitInput extends SlotHeadRequest {
  /** The plan's own meal for the slot on the date. */
  baseMealId: string;
  /** Minted by the server once per confirmed action, before the transaction. */
  overrideId: string;
  /** The complete meal the server resolved for the slot. */
  meal: PlannedMeal;
  source: MealOverrideOrigin;
}

export type SlotHeadUndoInput = SlotHeadRequest;

/**
 * What a request does to a head:
 *
 *   apply           write exactly `head` — the full next document
 *   alreadyApplied  the request id is in the ring; `head` is as it is. No write.
 *   staleRevision   the head is not at `expectedRevision`. No write, no retry.
 *   nothingToUndo   an undo found the base meal selected. No write.
 */
export type SlotHeadPlan =
  | { outcome: "apply"; head: SlotHead }
  | { outcome: "alreadyApplied"; head: SlotHead }
  | { outcome: "staleRevision"; currentRevision: number }
  | { outcome: "nothingToUndo" };

export class SlotHeadTransitionError extends Error {
  constructor(message: string) {
    super(`Invalid slot head transition: ${message}`);
    this.name = "SlotHeadTransitionError";
  }
}

const parseHead = (value: unknown, label: string): SlotHead => {
  const parsed = slotHeadSchema.safeParse(value);
  if (!parsed.success) throw new SlotHeadTransitionError(`${label} is not a valid SlotHead`);
  return parsed.data;
};

const requireAddress = (current: SlotHead | null, address: SlotHeadAddress): SlotHead | null => {
  if (current === null) return null;
  const head = parseHead(current, "the current head");
  if (head.planId !== address.planId || head.date !== address.date || head.slotId !== address.slotId) {
    throw new SlotHeadTransitionError("the current head is another slot's");
  }
  return head;
};

/**
 * Idempotency, then compare-and-set — in that order, so a retry of a request
 * that did land is a success, never a conflict. `null`: the request may apply.
 * The server asks this before reading anything else a request depends on.
 */
export const gateSlotHeadRequest = (
  head: SlotHead | null,
  request: Pick<SlotHeadRequest, "requestId" | "expectedRevision">
): Extract<SlotHeadPlan, { outcome: "alreadyApplied" | "staleRevision" }> | null => {
  // A request that already happened is a success, whatever revision it names.
  if (head !== null && head.appliedRequestIds.includes(request.requestId)) return { outcome: "alreadyApplied", head };
  const currentRevision = slotHeadRevision(head);
  if (request.expectedRevision !== currentRevision) return { outcome: "staleRevision", currentRevision };
  return null;
};

const nextHead = (
  head: SlotHead | null,
  request: SlotHeadRequest,
  selection: SlotSelection,
  overrides: Record<string, MealOverride>
): SlotHead =>
  parseHead(
    {
      schemaVersion: NUTRITION_SCHEMA_VERSION,
      planId: request.planId,
      date: request.date,
      slotId: request.slotId,
      revision: slotHeadRevision(head) + 1,
      selection,
      overrides,
      appliedRequestIds: appendSlotRequestId(head?.appliedRequestIds ?? [], request.requestId),
      updatedAt: { seconds: request.now.seconds, nanoseconds: request.now.nanoseconds },
    },
    "the next head"
  );

/**
 * Commit a replacement: a new immutable override, appended to the history and
 * selected. It follows whatever was selected — the previous override, or null
 * for the base meal — so undo can walk back. Neither input is changed.
 */
export const planSlotHeadCommit = (current: SlotHead | null, input: SlotHeadCommitInput): SlotHeadPlan => {
  const head = requireAddress(current, input);
  const gated = gateSlotHeadRequest(head, input);
  if (gated) return gated;

  if (head && Object.prototype.hasOwnProperty.call(head.overrides, input.overrideId)) {
    throw new SlotHeadTransitionError("the override id is already in the history");
  }
  const revision = slotHeadRevision(head) + 1;
  const override = mealOverrideSchema.safeParse({
    overrideId: input.overrideId,
    planId: input.planId,
    date: input.date,
    slotId: input.slotId,
    baseMealId: input.baseMealId,
    previousOverrideId: head?.selection.kind === "override" ? head.selection.overrideId : null,
    meal: input.meal,
    source: input.source,
    createdAtRevision: revision,
    createdAt: { seconds: input.now.seconds, nanoseconds: input.now.nanoseconds },
  });
  if (!override.success) throw new SlotHeadTransitionError("the new override is not a valid MealOverride");

  return {
    outcome: "apply",
    head: nextHead(head, input, { kind: "override", overrideId: input.overrideId }, {
      ...(head?.overrides ?? {}),
      [input.overrideId]: override.data,
    }),
  };
};

/**
 * Undo the selected override: select the one it followed, or the base meal
 * when it followed none. The history is kept as it is — nothing is removed.
 * Neither input is changed.
 */
export const planSlotHeadUndo = (current: SlotHead | null, input: SlotHeadUndoInput): SlotHeadPlan => {
  const head = requireAddress(current, input);
  const gated = gateSlotHeadRequest(head, input);
  if (gated) return gated;

  const selected = selectedMealOverride(head);
  if (head === null || selected === null) return { outcome: "nothingToUndo" };

  const selection: SlotSelection =
    selected.previousOverrideId === null ? { kind: "base" } : { kind: "override", overrideId: selected.previousOverrideId };
  return { outcome: "apply", head: nextHead(head, input, selection, { ...head.overrides }) };
};
