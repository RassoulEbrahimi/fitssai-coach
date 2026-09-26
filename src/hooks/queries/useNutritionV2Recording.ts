import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { assertAccountOwner } from "@/lib/accountIdentity";
import { enqueue, loadQueue, removeQuarantinedEntries } from "@/lib/offlineQueue";
import {
  isNutritionDate,
  nutritionDateAt,
  type NutritionDate,
  type NutritionEntryIntent,
  type RecordedEntry,
} from "@shared/nutrition";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { writeNutritionV2Entry } from "@/lib/nutrition/v2/entryWriter";
import { isNutritionEntryConflictError, type NutritionEntryWriteResult } from "@/lib/nutrition/v2/entryTransaction";
import { nutritionHandoffFor, recordNutritionHandoff } from "@/lib/nutrition/v2/entryHandoff";
import { readNutritionV2Entries } from "@/lib/nutrition/v2/firestoreReads";
import {
  buildNutritionEntryWritePayload,
  hasQueuedNutritionIntent,
  isQueueableNutritionWriteError,
  nutritionEntrySerializeKey,
  planNutritionApplyAgain,
  projectNutritionEntries,
  readOwnerNutritionQueue,
  type NutritionEntryConflict,
} from "@/lib/nutrition/v2/nutritionWriteIntents";
import {
  buildNutritionEntryIntent,
  isRecordableNutritionDate,
  nutritionRecordingCommandDate,
  type NutritionRecordingCommand,
} from "@/lib/nutrition/v2/recording";

/**
 * Nutrition V2 recording for the signed-in account (NUT-06 online, NUT-07
 * offline).
 *
 * - Writes happen only through `submit` (and a conflict's `applyAgain`),
 *   called from an explicit confirmation. Mounting, rendering or opening a
 *   form writes nothing.
 * - Only a signed-in, eligible adult (NUT-03) may write. Signed out, a profile
 *   still loading or failing, and a missing, unusable or under-18 age all
 *   refuse before anything is written or queued. Never a future Berlin date.
 *   Identity is the authenticated uid only.
 * - Each action creates ONE intent, with one new intent id, and that exact
 *   intent is what is written, retried by the transaction, queued and
 *   replayed. It is never rebuilt because the network failed: a write whose
 *   answer was lost may have landed, and replaying the same intent then is
 *   `alreadyApplied`, not a second action.
 * - Write or queue, per entry and in order:
 *     offline                          → queued, nothing sent
 *     an older intent for the entry
 *     is still queued                  → queued behind it
 *     otherwise                        → the online transaction; if the
 *                                        server cannot be reached, the same
 *                                        intent is queued
 *   A conflict, an invalid input, an account change or any other failure is
 *   never queued. Unrelated entries never wait for one another.
 * - The result says truthfully whether the change was `committed` on the
 *   server or only `queued` on this device.
 * - After a commit — or a conflict, which means the cache was stale — the
 *   account's entry queries (`queryKeys.nutrition.entries.all(uid)`) are
 *   refetched. Nothing else is invalidated.
 */

export type NutritionV2RecordingUnavailableReason = "signedOut" | "pending" | "error" | "ineligible";

export type NutritionV2RecordingAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2RecordingUnavailableReason };

/** An action that was refused before anything was written or queued. */
export class NutritionV2RecordingUnavailableError extends Error {
  readonly reason: NutritionV2RecordingUnavailableReason | "futureDate" | "offline";

  constructor(reason: NutritionV2RecordingUnavailableReason | "futureDate" | "offline") {
    super(`Nutrition V2 recording is unavailable (${reason})`);
    this.name = "NutritionV2RecordingUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2RecordingUnavailableError = (error: unknown): error is NutritionV2RecordingUnavailableError =>
  error instanceof NutritionV2RecordingUnavailableError;

/**
 * What happened to an accepted action:
 *
 *   committed  written on the server (`result` is the transaction's outcome)
 *   queued     stored on this device only, to be replayed; not yet saved
 */
export type NutritionV2SubmitResult =
  | { status: "committed"; result: NutritionEntryWriteResult }
  | { status: "queued"; queueEntryId: string };

/** "Apply again": a new action, or nothing left to do (a remove of an entry that is no longer active). */
export type NutritionV2ApplyAgainResult = NutritionV2SubmitResult | { status: "nothingToApply" };

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

/** The browser's online state, kept current by its online/offline events. */
const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, readOnline, () => true);

/* ------------------------------------------------------------------ *
 * Write or queue
 * ------------------------------------------------------------------ */

// Module scope: every mounted hook shares one lane per entry. A settled lane
// is one resolved promise per entry touched this session, so it is kept.
const lanes = new Map<string, Promise<void>>();

/** Runs `task` once every earlier task for the same entry has settled. */
const runInEntryLane = <T>(entryId: string, task: () => Promise<T>): Promise<T> => {
  const key = nutritionEntrySerializeKey(entryId);
  const run = (lanes.get(key) ?? Promise.resolve()).then(task);
  lanes.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
};

const coversDate = (key: readonly unknown[], date: NutritionDate): boolean => {
  const [, , , kind, from, to] = key;
  if (kind === "byDate") return from === date;
  if (kind === "range") return typeof from === "string" && typeof to === "string" && from <= date && date <= to;
  return false;
};

/** The freshest cached server read of `date`'s entries, or `null` when no cached read covers it. */
const cachedCommittedEntries = (queryClient: QueryClient, uid: string, date: NutritionDate): RecordedEntry[] | null => {
  let best: { entries: RecordedEntry[]; updatedAt: number } | null = null;
  for (const [key, data] of queryClient.getQueriesData<RecordedEntry[]>({ queryKey: queryKeys.nutrition.entries.all(uid) })) {
    if (!Array.isArray(data) || !coversDate(key, date)) continue;
    const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (best === null || updatedAt > best.updatedAt) best = { entries: data, updatedAt };
  }
  return best?.entries ?? null;
};

interface WriteVariables {
  uid: string;
  intent: NutritionEntryIntent;
  date: NutritionDate;
}

const writeOrQueue = async (queryClient: QueryClient, { uid, intent, date }: WriteVariables): Promise<NutritionV2SubmitResult> => {
  // Throws before anything is written if the intent could never be replayed.
  const payload = buildNutritionEntryWritePayload(intent, date);

  const queueIt = (): NutritionV2SubmitResult => {
    assertAccountOwner(uid);
    const queue = readOwnerNutritionQueue(loadQueue(), uid);
    // The queued intent it was made on top of, if any: if that one is
    // rejected, this one must not be written against a state it never saw.
    const { basedOn } = projectNutritionEntries({
      committed: cachedCommittedEntries(queryClient, uid, date) ?? [],
      handoff: nutritionHandoffFor(uid),
      queued: queue.active,
      covers: (candidate) => candidate === date,
    });
    const { entry } = enqueue("NUTRITION_ENTRY_WRITE", payload, uid, { dependsOn: basedOn.get(intent.entryId) ?? null });
    return { status: "queued", queueEntryId: entry.id };
  };

  return await runInEntryLane(intent.entryId, async () => {
    assertAccountOwner(uid);
    if (!navigator.onLine) return queueIt();
    // Never overtake an older intent for the same entry.
    if (hasQueuedNutritionIntent(readOwnerNutritionQueue(loadQueue(), uid).active, intent.entryId)) return queueIt();
    try {
      const result = await writeNutritionV2Entry(uid, intent);
      // Shown until a server read has it, so the refetch cannot flicker it away.
      if (result?.outcome === "applied") recordNutritionHandoff(uid, intent, date);
      return { status: "committed", result };
    } catch (error) {
      // The same intent, not a new one: the write may have landed.
      if (isQueueableNutritionWriteError(error)) return queueIt();
      throw error;
    }
  });
};

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

export interface NutritionV2Recording {
  availability: NutritionV2RecordingAvailability;
  /** Whether the browser reports a connection. Offline actions are queued, not refused. */
  online: boolean;
  /** One explicit, confirmed action. Rejects with the refusal, a conflict or the failure. */
  submit: (command: NutritionRecordingCommand) => Promise<NutritionV2SubmitResult>;
  /**
   * Re-apply a rejected offline change as a NEW action against the entry as
   * it is now on the server. Online only. The rejected records are removed
   * only once the new action is committed or safely queued.
   */
  applyAgain: (conflict: NutritionEntryConflict) => Promise<NutritionV2ApplyAgainResult>;
  /** Discard a rejected offline change on this device. Writes nothing to the server. */
  dismiss: (conflict: NutritionEntryConflict) => void;
  isSubmitting: boolean;
}

export const useNutritionV2Recording = (): NutritionV2Recording => {
  const access = useNutritionV2Access();
  const online = useOnline();
  const queryClient = useQueryClient();

  const refetchEntries = useCallback(
    (uid: string) => queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.entries.all(uid) }),
    [queryClient]
  );

  const { mutateAsync, isPending } = useMutation<NutritionV2SubmitResult, Error, WriteVariables>({
    mutationFn: (variables) => writeOrQueue(queryClient, variables),
    // Offline is handled here, by queueing; TanStack must not pause the action.
    networkMode: "always",
    // A conflict is never retried; any other failure is the person's to retry.
    retry: false,
    onSuccess: (result, { uid }) => (result.status === "committed" ? refetchEntries(uid) : undefined),
    onError: (error, { uid }) => (isNutritionEntryConflictError(error) ? refetchEntries(uid) : undefined),
  });

  const availability: NutritionV2RecordingAvailability =
    access.status === "eligible" ? { status: "available" } : { status: "unavailable", reason: access.status };

  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const requireUid = useCallback((): string => {
    if (unavailableReason !== null || uid === null) {
      throw new NutritionV2RecordingUnavailableError(unavailableReason ?? "pending");
    }
    return uid;
  }, [uid, unavailableReason]);

  const submit = useCallback(
    async (command: NutritionRecordingCommand): Promise<NutritionV2SubmitResult> => {
      const owner = requireUid();
      const date = nutritionRecordingCommandDate(command);
      if (!isRecordableNutritionDate(date, nutritionDateAt(new Date()))) {
        throw new NutritionV2RecordingUnavailableError("futureDate");
      }
      // Created once, here: every write, retry, queue entry and replay of
      // this action carries this intent.
      const intent = buildNutritionEntryIntent(command, crypto.randomUUID());
      return mutateAsync({ uid: owner, intent, date });
    },
    [mutateAsync, requireUid]
  );

  const applyAgain = useCallback(
    async (conflict: NutritionEntryConflict): Promise<NutritionV2ApplyAgainResult> => {
      const owner = requireUid();
      // What the server holds now has to be read first; offline it cannot be.
      if (!navigator.onLine) throw new NutritionV2RecordingUnavailableError("offline");
      const { date, entryId } = conflict;
      if (!isNutritionDate(date) || !isRecordableNutritionDate(date, nutritionDateAt(new Date()))) {
        throw new NutritionV2RecordingUnavailableError("futureDate");
      }

      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.nutrition.entries.byDate(owner, date),
        queryFn: () => readNutritionV2Entries(owner, date, date),
        staleTime: 0,
      });
      assertAccountOwner(owner);
      // The entry as it is now: the server's copy, with whatever this device
      // has queued for it since.
      const current =
        projectNutritionEntries({
          committed: fresh,
          handoff: nutritionHandoffFor(owner),
          queued: readOwnerNutritionQueue(loadQueue(), owner).active,
          covers: (candidate) => candidate === date,
        }).entries.find((entry) => entry.entryId === entryId) ?? null;

      const plan = planNutritionApplyAgain(conflict, current);
      const result: NutritionV2ApplyAgainResult =
        plan.kind === "nothingToApply"
          ? { status: "nothingToApply" }
          : // A NEW intent with a new id: the rejected one is never replayed.
            await mutateAsync({ uid: owner, intent: buildNutritionEntryIntent(plan.command, crypto.randomUUID()), date });

      // Only now: the replacement is committed or durably queued.
      removeQuarantinedEntries(conflict.queueEntryIds, owner);
      void refetchEntries(owner);
      return result;
    },
    [mutateAsync, queryClient, refetchEntries, requireUid]
  );

  const dismiss = useCallback(
    (conflict: NutritionEntryConflict) => {
      removeQuarantinedEntries(conflict.queueEntryIds, requireUid());
    },
    [requireUid]
  );

  return { availability, online, submit, applyAgain, dismiss, isSubmitting: isPending };
};
