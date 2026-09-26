import {
  isActiveRecordedEntry,
  isNutritionDate,
  nutritionEntryIntentSchema,
  parseEntryId,
  planNutritionEntryWrite,
  type NutritionDate,
  type NutritionEntryIntent,
  type RecordedEntry,
} from "@shared/nutrition";
import type { NutritionEntryWritePayload } from "@/lib/offlineQueue";
import type { NutritionRecordingCommand } from "./recording";

/**
 * Nutrition V2 entry intents that the server has not confirmed to this device
 * yet, and what the entries look like with them applied (NUT-07). Pure: no
 * Firestore, React, storage, clock or randomness. Callers hand in the parsed
 * queue and the committed entries; nothing passed in is modified.
 *
 * Every projection runs the one shared planner, `planNutritionEntryWrite`,
 * over the committed entry in queue order — exactly what replay will do on
 * the server. So a predicted revision is the planner's answer, never
 * "revision + number of queued items": an intent that is already applied, a
 * no-op or a conflict changes nothing, here as on the server.
 *
 * Only RECORDED entries are projected. Plans, slot heads and targets are
 * never touched, so PLANNED values stay exactly as read.
 */

export const NUTRITION_ENTRY_WRITE_TYPE = "NUTRITION_ENTRY_WRITE";

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

/**
 * A queued payload, checked against the shared schemas, or `null` when any
 * part is unusable. Nothing is repaired: a valid payload is returned as it
 * was stored.
 *
 * Checks the intent itself (`nutritionEntryIntentSchema`), that the entry id
 * is canonical, that a slot entry's id names `date`, and that a save's
 * desired state is for `date`.
 */
export const parseNutritionEntryWritePayload = (value: unknown): NutritionEntryWritePayload | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("intent") || !keys.includes("date")) return null;
  const { intent, date } = value as { intent: unknown; date: unknown };
  if (!isNutritionDate(date)) return null;

  const parsed = nutritionEntryIntentSchema.safeParse(intent);
  if (!parsed.success) return null;
  const entry = parseEntryId(parsed.data.entryId);
  if (entry === null) return null;
  if (entry.kind === "slot" && entry.date !== date) return null;
  if (parsed.data.op !== "remove" && parsed.data.desired.date !== date) return null;

  return value as NutritionEntryWritePayload;
};

/** The payload for `intent` on `date`. Throws on anything the replay handler would reject. */
export const buildNutritionEntryWritePayload = (
  intent: NutritionEntryIntent,
  date: NutritionDate
): NutritionEntryWritePayload => {
  const payload = { intent, date };
  if (parseNutritionEntryWritePayload(payload) === null) {
    throw new RangeError("Nutrition entry intent cannot be queued: it does not match its date or schema");
  }
  return payload;
};

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

/** A queued intent that still counts: pending, being replayed, or waiting after a transient failure. */
export interface NutritionQueuedIntent {
  queueEntryId: string;
  status: "pending" | "syncing" | "failed";
  intent: NutritionEntryIntent;
  date: NutritionDate;
}

/** A queued intent replay set aside for good. It never projects. */
export interface NutritionRejectedIntent {
  queueEntryId: string;
  intent: NutritionEntryIntent;
  date: NutritionDate;
  /** The stored rejection code; `null` if quarantined without one. */
  code: string | null;
}

export interface OwnerNutritionQueue {
  /** In queue order. */
  active: NutritionQueuedIntent[];
  /** In queue order. */
  rejected: NutritionRejectedIntent[];
}

const ACTIVE_STATUSES = new Set(["pending", "syncing", "failed"]);

/** The persisted queue as stored, or an empty list when it cannot be read. Never throws. */
export const parseQueueStorage = (raw: string | null): unknown[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * `ownerUid`'s Nutrition entry intents from the queue, in queue order.
 * Another account's entries, ownerless entries, Training entries and
 * malformed Nutrition payloads are left out.
 */
export const readOwnerNutritionQueue = (queue: readonly unknown[], ownerUid: string | null | undefined): OwnerNutritionQueue => {
  const result: OwnerNutritionQueue = { active: [], rejected: [] };
  if (typeof ownerUid !== "string" || ownerUid.length === 0) return result;
  for (const item of queue) {
    if (item === null || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (entry.ownerUid !== ownerUid || entry.type !== NUTRITION_ENTRY_WRITE_TYPE || typeof entry.id !== "string") continue;
    const payload = parseNutritionEntryWritePayload(entry.payload);
    if (payload === null) continue;
    if (ACTIVE_STATUSES.has(entry.status as string)) {
      result.active.push({
        queueEntryId: entry.id,
        status: entry.status as NutritionQueuedIntent["status"],
        intent: payload.intent,
        date: payload.date,
      });
    } else if (entry.status === "quarantined") {
      const rejection = entry.rejection as { code?: unknown } | undefined;
      result.rejected.push({
        queueEntryId: entry.id,
        intent: payload.intent,
        date: payload.date,
        code: typeof rejection?.code === "string" ? rejection.code : null,
      });
    }
  }
  return result;
};

/** Whether `entryId` has an intent still waiting in the queue. A later action for it must wait behind it. */
export const hasQueuedNutritionIntent = (active: readonly NutritionQueuedIntent[], entryId: string): boolean =>
  active.some((queued) => queued.intent.entryId === entryId);

/** Writes to one entry are ordered; writes to different entries are not. */
export const nutritionEntrySerializeKey = (entryId: string): string => `nutrition-entry:${entryId}`;

/* ------------------------------------------------------------------ *
 * Projection
 * ------------------------------------------------------------------ */

/** An intent the server accepted that a server read may not show yet. */
export interface NutritionHandoffIntent {
  intent: NutritionEntryIntent;
  date: NutritionDate;
}

export interface NutritionEntryPendingState {
  entryId: string;
  date: NutritionDate;
  /** `failed` if any queued intent is waiting after a transient failure, else `syncing` or `pending`. */
  status: "pending" | "syncing" | "failed";
  count: number;
}

export interface NutritionEntryProjection {
  /** The committed entries with local intents applied. Unchanged entries are the committed objects. */
  entries: RecordedEntry[];
  /** Entries with intents still in the queue. */
  pending: ReadonlyMap<string, NutritionEntryPendingState>;
  /**
   * Per entry with queued intents: the queue entry whose intent last changed
   * the projected entry, or `null` when the projected entry is a committed
   * one. A new intent for the entry depends on that queue entry.
   */
  basedOn: ReadonlyMap<string, string | null>;
}

const PENDING_RANK = { pending: 0, syncing: 1, failed: 2 } as const;

/** The planner's next entry for `intent`, or `null` when it changes nothing (or cannot be planned). */
const applied = (current: RecordedEntry | null, intent: NutritionEntryIntent): RecordedEntry | null => {
  try {
    const plan = planNutritionEntryWrite(current, intent);
    return plan.outcome === "apply" ? plan.entry : null;
  } catch {
    return null;
  }
};

/**
 * The entries as the person should see them: `committed`, then `handoff`
 * intents, then `queued` intents, each in order, through the planner.
 *
 * `covers` says which dates the committed read covers. An intent for a date
 * it does not cover is left out: without that date's committed entry there is
 * nothing to apply it to.
 */
export const projectNutritionEntries = ({
  committed,
  handoff = [],
  queued,
  covers = () => true,
}: {
  committed: readonly RecordedEntry[];
  handoff?: readonly NutritionHandoffIntent[];
  queued: readonly NutritionQueuedIntent[];
  covers?: (date: NutritionDate) => boolean;
}): NutritionEntryProjection => {
  const current = new Map<string, RecordedEntry>(committed.map((entry) => [entry.entryId, entry]));
  const added: string[] = [];
  const basedOn = new Map<string, string | null>();
  const pending = new Map<string, NutritionEntryPendingState>();

  const step = (intent: NutritionEntryIntent, queueEntryId: string | null) => {
    const next = applied(current.get(intent.entryId) ?? null, intent);
    if (next === null) return;
    if (!current.has(intent.entryId)) added.push(intent.entryId);
    current.set(intent.entryId, next);
    if (queueEntryId !== null) basedOn.set(intent.entryId, queueEntryId);
  };

  for (const { intent, date } of handoff) if (covers(date)) step(intent, null);
  for (const { intent, date, status, queueEntryId } of queued) {
    if (!covers(date)) continue;
    if (!basedOn.has(intent.entryId)) basedOn.set(intent.entryId, null);
    step(intent, queueEntryId);
    const before = pending.get(intent.entryId);
    pending.set(intent.entryId, {
      entryId: intent.entryId,
      date,
      status: before && PENDING_RANK[before.status] > PENDING_RANK[status] ? before.status : status,
      count: (before?.count ?? 0) + 1,
    });
  }

  const entries = [
    ...committed.map((entry) => current.get(entry.entryId) ?? entry),
    ...added.map((entryId) => current.get(entryId)).filter((entry): entry is RecordedEntry => entry !== undefined),
  ];
  return { entries, pending, basedOn };
};

/**
 * The handoff intents a server read does not show yet: those that would
 * still change the entry. An intent the read already shows (applied), one
 * with nothing to do, and one the read has moved past are settled by it.
 */
export const unsettledHandoffIntents = <H extends NutritionHandoffIntent>({
  committed,
  handoff,
  covers = () => true,
}: {
  committed: readonly RecordedEntry[];
  handoff: readonly H[];
  covers?: (date: NutritionDate) => boolean;
}): H[] => {
  const current = new Map<string, RecordedEntry>(committed.map((entry) => [entry.entryId, entry]));
  return handoff.filter((item) => {
    if (!covers(item.date)) return true;
    const next = applied(current.get(item.intent.entryId) ?? null, item.intent);
    if (next === null) return false;
    current.set(item.intent.entryId, next);
    return true;
  });
};

/* ------------------------------------------------------------------ *
 * Online or queue
 * ------------------------------------------------------------------ */

/**
 * Firestore codes that mean "the server could not be reached, or did not
 * answer in time": the write may or may not have landed. Queueing the same
 * intent is safe, because replaying it is idempotent.
 */
const QUEUEABLE_FIRESTORE_CODES = new Set(["unavailable", "deadline-exceeded"]);

const NETWORK_FAILURE_MESSAGES = ["Failed to fetch", "Network request failed"];

/**
 * Whether a failed online Nutrition write may be queued for replay.
 *
 * Only a clearly transient connectivity failure. Everything else — a
 * conflict, an invalid intent or input, a malformed server document, an
 * account change, a permission refusal, any other Firestore code or an
 * unknown error — is not: it would fail the same way on replay, or it is the
 * person's to see.
 */
export const isQueueableNutritionWriteError = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string") return QUEUEABLE_FIRESTORE_CODES.has(code.replace(/^firestore\//, ""));
  return error instanceof TypeError && typeof message === "string" && NETWORK_FAILURE_MESSAGES.some((text) => message.includes(text));
};

/* ------------------------------------------------------------------ *
 * Conflicts
 * ------------------------------------------------------------------ */

/**
 * One entry whose offline change replay could not apply. Several rejected
 * intents of the same entry (a chain) are one conflict: the latest is what
 * the person last asked for.
 */
export interface NutritionEntryConflict {
  entryId: string;
  date: NutritionDate;
  /** Every quarantined queue entry of this entry, in queue order. */
  queueEntryIds: string[];
  /** The latest rejected intent. */
  intent: NutritionEntryIntent;
}

export const groupNutritionConflicts = (rejected: readonly NutritionRejectedIntent[]): NutritionEntryConflict[] => {
  const byEntry = new Map<string, NutritionEntryConflict>();
  for (const { queueEntryId, intent, date } of rejected) {
    const existing = byEntry.get(intent.entryId);
    if (existing) {
      existing.queueEntryIds.push(queueEntryId);
      existing.intent = intent;
      existing.date = date;
    } else {
      byEntry.set(intent.entryId, { entryId: intent.entryId, date, queueEntryIds: [queueEntryId], intent });
    }
  }
  return [...byEntry.values()];
};

/**
 * What "apply again" asks for against `current`, the entry as it is now: the
 * rejected action, re-evaluated. A save becomes a new save of the same desired
 * state (a `correct` if the entry is active now, else a `record` or `skip`);
 * a remove removes the entry if it is active, and has nothing to do if not.
 * The caller builds a NEW intent from the command; nothing is rebased here.
 */
export type NutritionApplyAgainPlan =
  | { kind: "command"; command: NutritionRecordingCommand }
  | { kind: "nothingToApply" };

export const planNutritionApplyAgain = (
  conflict: Pick<NutritionEntryConflict, "entryId" | "intent">,
  current: RecordedEntry | null
): NutritionApplyAgainPlan => {
  if (current !== null && current.entryId !== conflict.entryId) {
    throw new RangeError(`current entry ${current.entryId} is not ${conflict.entryId}`);
  }
  const { intent } = conflict;
  if (intent.op === "remove") {
    return current !== null && isActiveRecordedEntry(current)
      ? { kind: "command", command: { kind: "remove", current } }
      : { kind: "nothingToApply" };
  }
  return { kind: "command", command: { kind: "save", current, desired: intent.desired } };
};
