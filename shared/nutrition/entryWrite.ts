import { z } from "zod";
import {
  NUTRITION_ENTRY_INTENT_RING_SIZE,
  RECORDED_ENTRY_IDENTITY_FIELDS,
  nutritionIntentIdSchema,
  recordedEntrySchema,
  recordedEntrySnapshotSchema,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "./contracts";

/**
 * The one planner for a Nutrition V2 recorded-entry write.
 *
 *   planNutritionEntryWrite(current, intent)  →  apply | alreadyApplied | noop | conflict
 *
 * Every client writer — the online transaction today, offline replay later —
 * reads the current entry, asks this planner what to do, and does exactly
 * that. Pure: no Firestore, React, browser or Node API, no clock, no network,
 * no randomness. The intent id is supplied by the caller, created once per
 * explicit user action.
 *
 * Compare-and-set on `revision`: an intent names the revision it was made
 * against, and applies only if that is still the current one. There is no
 * last-write-wins and no automatic retry against a newer revision — a stale
 * intent is a `conflict` for the caller to surface.
 *
 * Idempotent through `appliedIntentIds`: an intent already listed there has
 * happened, and is `alreadyApplied` whatever revision it names. That check
 * comes before the revision check, so a retry of a write that did land is a
 * success, never a conflict.
 *
 * Nothing is hard-deleted: `remove` writes a `removed` tombstone that keeps
 * the entry's last snapshot. A tombstoned slot can be recorded again under
 * the same id, as its next revision.
 */

/* ------------------------------------------------------------------ *
 * Intents
 * ------------------------------------------------------------------ */

/**
 * What an explicit action asks for:
 *
 *   record   record a meal (planned or custom) where no active entry exists
 *   skip     record an explicit skip where no active entry exists
 *   correct  replace an active entry's recording with another one
 *   remove   take an active entry back (tombstone)
 */
export const NUTRITION_ENTRY_OPS = ["record", "skip", "correct", "remove"] as const;

export type NutritionEntryOp = (typeof NUTRITION_ENTRY_OPS)[number];

const intentBase = {
  intentId: nutritionIntentIdSchema,
  entryId: z.string(),
  /** The revision the action was made against; 0 means "no entry yet". */
  expectedRevision: z.number().int("expectedRevision must be a whole number").nonnegative(),
};

/**
 * One explicit mutation of one entry. `desired` is the FULL semantic state the
 * entry should have afterwards — never a patch.
 */
export const nutritionEntryIntentSchema = z
  .discriminatedUnion("op", [
    z.object({ ...intentBase, op: z.literal("record"), desired: recordedEntrySnapshotSchema }).strict(),
    z.object({ ...intentBase, op: z.literal("skip"), desired: recordedEntrySnapshotSchema }).strict(),
    z.object({ ...intentBase, op: z.literal("correct"), desired: recordedEntrySnapshotSchema }).strict(),
    z.object({ ...intentBase, op: z.literal("remove") }).strict(),
  ])
  .superRefine((intent, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (intent.op === "remove") return;
    if (intent.desired.entryId !== intent.entryId) issue(["desired", "entryId"], "desired state is for another entry");
    if (intent.op === "record" && intent.desired.recording === "skip") {
      issue(["desired", "recording"], "a skip is recorded with op skip");
    }
    if (intent.op === "skip" && intent.desired.recording !== "skip") {
      issue(["desired", "recording"], "op skip records a skip");
    }
  });

export type NutritionEntryIntent = z.infer<typeof nutritionEntryIntentSchema>;

/** An intent the planner cannot even consider: malformed, or aimed at another entry's identity. */
export class NutritionEntryIntentError extends Error {
  constructor(message: string) {
    super(`Invalid Nutrition entry intent: ${message}`);
    this.name = "NutritionEntryIntentError";
  }
}

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

/**
 * Why an intent does not apply to the current entry:
 *
 *   staleRevision  the entry is no longer at `expectedRevision`
 *   notActive      a `correct` found no active entry to correct
 *   alreadyActive  a `record` or `skip` found an active entry; changing one is
 *                  a `correct`, and the intent is never rewritten into one
 */
export type NutritionEntryConflictReason = "staleRevision" | "notActive" | "alreadyActive";

export type NutritionEntryWritePlan =
  /** Write exactly `entry` — the full next document. */
  | { outcome: "apply"; entry: RecordedEntry }
  /** The intent already happened; `entry` is the current document. No write. */
  | { outcome: "alreadyApplied"; entry: RecordedEntry }
  /** Nothing to do: removing an entry that is absent or already removed. No write. */
  | { outcome: "noop"; entry: RecordedEntry | null }
  /** The intent does not fit the current entry. No write, no retry. */
  | {
      outcome: "conflict";
      reason: NutritionEntryConflictReason;
      entryId: string;
      expectedRevision: number;
      /** 0 when there is no entry. */
      currentRevision: number;
      current: RecordedEntry | null;
    };

/** The ring after applying `intentId`: appended, then the oldest dropped down to the ring size. */
export const appendAppliedIntentId = (ring: readonly string[], intentId: string): string[] =>
  [...ring, intentId].slice(-NUTRITION_ENTRY_INTENT_RING_SIZE);

const parseOrThrow = <S extends z.ZodTypeAny>(schema: S, value: unknown, label: string): z.output<S> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NutritionEntryIntentError(`${label}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
};

const sameIdentity = (current: RecordedEntry, desired: RecordedEntrySnapshot): boolean =>
  RECORDED_ENTRY_IDENTITY_FIELDS.every((field) => current[field] === desired[field]);

/**
 * Decide what `intent` does to `current` (`null`: no entry document exists).
 *
 * Neither input is modified; every returned entry is a fresh object.
 */
export const planNutritionEntryWrite = (
  current: RecordedEntry | null,
  intent: NutritionEntryIntent
): NutritionEntryWritePlan => {
  const next = parseOrThrow(nutritionEntryIntentSchema, intent, "intent");
  const existing = current === null ? null : parseOrThrow(recordedEntrySchema, current, "current entry");
  if (existing !== null && existing.entryId !== next.entryId) {
    throw new NutritionEntryIntentError(`current entry ${existing.entryId} is not ${next.entryId}`);
  }

  // Idempotency first: a retried write that already landed is a success.
  if (existing !== null && existing.appliedIntentIds.includes(next.intentId)) {
    return { outcome: "alreadyApplied", entry: existing };
  }

  // Removing what is not there (or no longer there) needs nothing.
  if (next.op === "remove" && (existing === null || existing.status === "removed")) {
    return { outcome: "noop", entry: existing };
  }

  const currentRevision = existing?.revision ?? 0;
  const conflict = (reason: NutritionEntryConflictReason): NutritionEntryWritePlan => ({
    outcome: "conflict",
    reason,
    entryId: next.entryId,
    expectedRevision: next.expectedRevision,
    currentRevision,
    current: existing,
  });

  if (next.expectedRevision !== currentRevision) return conflict("staleRevision");
  // Operation state: record and skip start a recording (none yet, or over a
  // tombstone); correct changes an active one. Remove was settled above.
  const active = existing?.status === "active";
  if (next.op === "correct" && !active) return conflict("notActive");
  if ((next.op === "record" || next.op === "skip") && active) return conflict("alreadyActive");

  const revision = currentRevision + 1;
  const appliedIntentIds = appendAppliedIntentId(existing?.appliedIntentIds ?? [], next.intentId);

  if (next.op === "remove") {
    // `existing` is active here. The tombstone keeps its snapshot as history.
    return {
      outcome: "apply",
      entry: recordedEntrySchema.parse({ ...existing, status: "removed", revision, appliedIntentIds }),
    };
  }

  if (existing !== null && !sameIdentity(existing, next.desired)) {
    throw new NutritionEntryIntentError(`the identity of ${next.entryId} cannot change`);
  }

  return {
    outcome: "apply",
    entry: recordedEntrySchema.parse({ ...next.desired, revision, status: "active", appliedIntentIds }),
  };
};
