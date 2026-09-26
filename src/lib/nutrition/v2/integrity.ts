import type { ZodIssue, ZodType } from "zod";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  isNutritionDate,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  recordedEntrySchema,
  slotHeadId,
  slotHeadSchema,
  targetVersionSchema,
  type NutritionDate,
  type NutritionPlan,
  type NutritionUserState,
  type RecordedEntry,
  type SlotHead,
  type TargetVersion,
} from "@shared/nutrition";

/**
 * The Nutrition V2 trust boundary on the client.
 *
 * Every V2 document read from Firestore passes through exactly one of these
 * parsers before anything else sees it. Pure: no Firestore, no React, no clock.
 *
 * V2 is strict. `schemaVersion: 2` documents are authoritative, so a document
 * that does not match its NUT-01 schema, sits under an id that does not name
 * it, or answers a read it does not belong to is an integrity failure. It
 * throws, and nothing is skipped, defaulted, coerced or repaired. (Legacy
 * Nutrition is tolerant because its stored schema is unknown; none of that
 * tolerance applies here, and nothing here reads or falls back to legacy.)
 */

export type NutritionV2IntegrityCode =
  /** The document does not match its V2 schema. */
  | "malformed"
  /** The Firestore document id does not match the id the document carries. */
  | "idMismatch"
  /** A state pointer names a document that does not exist. */
  | "missingDocument"
  /** A valid document that does not belong to the read that returned it. */
  | "outOfScope";

export class NutritionV2IntegrityError extends Error {
  readonly code: NutritionV2IntegrityCode;
  /** `collection/docId` of the offending document — never an account id. */
  readonly documentPath: string;
  readonly issues: readonly ZodIssue[];

  constructor(code: NutritionV2IntegrityCode, documentPath: string, detail: string, issues: readonly ZodIssue[] = []) {
    super(`Nutrition V2 integrity failure (${code}) at ${documentPath}: ${detail}`);
    this.name = "NutritionV2IntegrityError";
    this.code = code;
    this.documentPath = documentPath;
    this.issues = issues;
  }
}

export const isNutritionV2IntegrityError = (error: unknown): error is NutritionV2IntegrityError =>
  error instanceof NutritionV2IntegrityError;

/** A raw Firestore document: its id and whatever `data()` returned. */
export interface NutritionV2RawDoc {
  id: string;
  data: unknown;
}

const documentPath = (collection: string, id: string) => `${collection}/${id}`;

const parseStrict = <T>(schema: ZodType<T>, raw: unknown, path: string): T => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new NutritionV2IntegrityError("malformed", path, "document does not match its schema", parsed.error.issues);
  }
  return parsed.data;
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/**
 * `users/{uid}/nutrition_v2_state/current`. `exists: false` is the one
 * non-error empty answer: V2 has not been initialised for the account.
 */
export const parseNutritionV2State = (snapshot: { exists: boolean; data: unknown }): NutritionUserState | null => {
  if (!snapshot.exists) return null;
  return parseStrict(
    nutritionUserStateSchema,
    snapshot.data,
    documentPath(NUTRITION_V2_COLLECTIONS.state, NUTRITION_V2_STATE_DOC_ID)
  );
};

/* ------------------------------------------------------------------ *
 * Pointer-backed documents
 * ------------------------------------------------------------------ */

/** A document a state pointer names. Absent is an integrity failure, never "none". */
const requirePointed = (
  collection: string,
  pointerId: string,
  snapshot: { id: string; exists: boolean; data: unknown }
): { path: string; data: unknown } => {
  const path = documentPath(collection, pointerId);
  if (snapshot.id !== pointerId) {
    throw new NutritionV2IntegrityError("idMismatch", path, `read returned document ${snapshot.id}`);
  }
  if (!snapshot.exists) {
    throw new NutritionV2IntegrityError("missingDocument", path, "the state points to a document that does not exist");
  }
  return { path, data: snapshot.data };
};

/** The target version `state.currentTargetVersionId` names. */
export const parseNutritionV2Target = (
  targetVersionId: string,
  snapshot: { id: string; exists: boolean; data: unknown }
): TargetVersion => {
  const { path, data } = requirePointed(NUTRITION_V2_COLLECTIONS.targets, targetVersionId, snapshot);
  const target = parseStrict(targetVersionSchema, data, path);
  if (target.targetVersionId !== snapshot.id) {
    throw new NutritionV2IntegrityError("idMismatch", path, `document carries targetVersionId ${target.targetVersionId}`);
  }
  return target;
};

/** The plan `state.activePlanId` names. */
export const parseNutritionV2Plan = (
  planId: string,
  snapshot: { id: string; exists: boolean; data: unknown }
): NutritionPlan => {
  const { path, data } = requirePointed(NUTRITION_V2_COLLECTIONS.plans, planId, snapshot);
  const plan = parseStrict(nutritionPlanSchema, data, path);
  if (plan.planId !== snapshot.id) {
    throw new NutritionV2IntegrityError("idMismatch", path, `document carries planId ${plan.planId}`);
  }
  return plan;
};

/* ------------------------------------------------------------------ *
 * Slot heads
 * ------------------------------------------------------------------ */

/**
 * Every slot head returned for `plan`. Each must be a valid head of that
 * plan, on one of its dates, for one of its configured slots, stored under
 * `slotHeadId(planId, date, slotId)`. A slot without a head is fine — it shows
 * the base meal — so no head is ever invented here.
 */
export const parseNutritionV2SlotHeads = (plan: NutritionPlan, docs: readonly NutritionV2RawDoc[]): SlotHead[] => {
  const planDates = new Set(plan.days.map((day) => day.date));
  const configured = new Set<string>(plan.slotOrder);

  return docs.map(({ id, data }) => {
    const path = documentPath(NUTRITION_V2_COLLECTIONS.slots, id);
    const head = parseStrict(slotHeadSchema, data, path);
    if (head.planId !== plan.planId) {
      throw new NutritionV2IntegrityError("outOfScope", path, `slot head belongs to plan ${head.planId}`);
    }
    if (!planDates.has(head.date)) {
      throw new NutritionV2IntegrityError("outOfScope", path, `date ${head.date} is not a day of the plan`);
    }
    if (!configured.has(head.slotId)) {
      throw new NutritionV2IntegrityError("outOfScope", path, `slot ${head.slotId} is not configured by the plan`);
    }
    if (id !== slotHeadId(head.planId, head.date, head.slotId)) {
      throw new NutritionV2IntegrityError("idMismatch", path, "id is not slotHeadId(planId, date, slotId)");
    }
    return head;
  });
};

/* ------------------------------------------------------------------ *
 * Recorded entries
 * ------------------------------------------------------------------ */

/** The inclusive date span an entry read asked for. */
export interface NutritionV2DateSpan {
  from: NutritionDate;
  to: NutritionDate;
}

/** Throws unless `from` and `to` are real dates with `from <= to`. */
export const assertNutritionV2DateSpan = (span: NutritionV2DateSpan): NutritionV2DateSpan => {
  if (!isNutritionDate(span.from) || !isNutritionDate(span.to) || span.from > span.to) {
    throw new RangeError("an entry read needs dates YYYY-MM-DD with from <= to");
  }
  return span;
};

/**
 * Every entry returned for `span`, exactly as recorded. Each must be a valid
 * `RecordedEntry`, stored under its own `entryId`, dated inside the span.
 * Nothing is recomputed, merged or synthesised.
 */
export const parseNutritionV2Entries = (
  span: NutritionV2DateSpan,
  docs: readonly NutritionV2RawDoc[]
): RecordedEntry[] => {
  const { from, to } = assertNutritionV2DateSpan(span);

  return docs.map(({ id, data }) => {
    const path = documentPath(NUTRITION_V2_COLLECTIONS.entries, id);
    const entry = parseStrict(recordedEntrySchema, data, path);
    if (entry.entryId !== id) {
      throw new NutritionV2IntegrityError("idMismatch", path, "id is not the entry's entryId");
    }
    // Dates are YYYY-MM-DD, so string order is calendar order.
    if (entry.date < from || entry.date > to) {
      throw new NutritionV2IntegrityError("outOfScope", path, `date ${entry.date} is outside ${from}..${to}`);
    }
    return entry;
  });
};
