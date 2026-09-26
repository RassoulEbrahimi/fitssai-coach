import {
  planNutritionEntryWrite,
  type NutritionEntryConflictReason,
  type NutritionEntryIntent,
  type RecordedEntry,
} from "@shared/nutrition";
import { parseNutritionV2Entry } from "./integrity";

/**
 * The body of the Nutrition V2 entry write transaction:
 *
 *   read the entry → strict-parse it → ask the shared planner → do exactly that
 *
 * Kept free of the Firebase SDK (it talks to a minimal transaction port), so
 * the same step runs inside `runTransaction` in the app and against any other
 * transaction in tests. It reads and writes one document — the intent's entry —
 * and nothing else. It never deletes.
 *
 * A transaction may run this more than once when Firestore retries it; the
 * intent (and its id) is created before the transaction and is the same on
 * every run.
 */

/** A Firestore document snapshot, as far as this step needs one. */
export interface NutritionEntrySnapshotLike {
  id: string;
  exists(): boolean;
  data(): unknown;
}

/** The part of a Firestore transaction this step uses. */
export interface NutritionEntryTransaction<Ref> {
  get(ref: Ref): Promise<NutritionEntrySnapshotLike>;
  set(ref: Ref, data: RecordedEntry): unknown;
}

/**
 * The intent does not fit the entry as it is now. Nothing was written, and the
 * write is not retried against the newer revision: the person has to see the
 * current entry and decide again.
 */
export class NutritionEntryConflictError extends Error {
  readonly reason: NutritionEntryConflictReason;
  readonly entryId: string;
  readonly expectedRevision: number;
  /** 0 when no entry exists. */
  readonly currentRevision: number;
  /** The entry as it is on the server, or `null` if there is none. */
  readonly current: RecordedEntry | null;

  constructor({
    reason,
    entryId,
    expectedRevision,
    currentRevision,
    current,
  }: {
    reason: NutritionEntryConflictReason;
    entryId: string;
    expectedRevision: number;
    currentRevision: number;
    current: RecordedEntry | null;
  }) {
    super(
      `Nutrition entry ${entryId} conflict (${reason}): expected revision ${expectedRevision}, current ${currentRevision}`
    );
    this.name = "NutritionEntryConflictError";
    this.reason = reason;
    this.entryId = entryId;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
    this.current = current;
  }
}

export const isNutritionEntryConflictError = (error: unknown): error is NutritionEntryConflictError =>
  error instanceof NutritionEntryConflictError;

/**
 * What a successful write did:
 *
 *   applied         the entry was written; `entry` is the new document
 *   alreadyApplied  the intent had already been applied; `entry` is current
 *   noop            nothing to do (removing an absent or removed entry)
 */
export type NutritionEntryWriteResult =
  | { outcome: "applied"; entry: RecordedEntry }
  | { outcome: "alreadyApplied"; entry: RecordedEntry }
  | { outcome: "noop"; entry: RecordedEntry | null };

/** Run one intent against `ref` inside `transaction`. Throws `NutritionEntryConflictError` on a conflict. */
export const applyNutritionEntryIntent = async <Ref>(
  transaction: NutritionEntryTransaction<Ref>,
  ref: Ref,
  intent: NutritionEntryIntent
): Promise<NutritionEntryWriteResult> => {
  const snapshot = await transaction.get(ref);
  const current = parseNutritionV2Entry(intent.entryId, {
    id: snapshot.id,
    exists: snapshot.exists(),
    data: snapshot.exists() ? snapshot.data() : undefined,
  });

  const plan = planNutritionEntryWrite(current, intent);
  switch (plan.outcome) {
    case "apply":
      transaction.set(ref, plan.entry);
      return { outcome: "applied", entry: plan.entry };
    case "alreadyApplied":
      return { outcome: "alreadyApplied", entry: plan.entry };
    case "noop":
      return { outcome: "noop", entry: plan.entry };
    case "conflict":
      throw new NutritionEntryConflictError(plan);
  }
};
