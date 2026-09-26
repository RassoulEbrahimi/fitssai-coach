import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { NutritionDate, RecordedEntry } from "@shared/nutrition";
import { QUEUE_CHANGED_EVENT, peekQueueStorage } from "@/lib/offlineQueue";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import {
  getNutritionHandoffVersion,
  nutritionHandoffFor,
  settleNutritionHandoff,
  subscribeNutritionHandoff,
} from "@/lib/nutrition/v2/entryHandoff";
import {
  groupNutritionConflicts,
  parseQueueStorage,
  projectNutritionEntries,
  readOwnerNutritionQueue,
  type NutritionEntryConflict,
  type NutritionEntryPendingState,
} from "@/lib/nutrition/v2/nutritionWriteIntents";
import type { NutritionV2Read } from "@/lib/nutrition/v2/readStatus";

/**
 * The recorded entries as this device should show them (NUT-07):
 *
 *   strict committed read → this account's queued and handed-off intents → view
 *
 * The committed read stays exactly what Firestore returned; this only lays
 * the account's own local intents over it, through the shared planner, for
 * the dates the read covers. Quarantined intents never project — they are
 * returned as `conflicts` instead. Another account's intents, and every
 * Training entry, are ignored. Reading this writes nothing.
 */

export interface NutritionV2EntryOverlay {
  /** The committed read's status, with its data projected. */
  entries: NutritionV2Read<RecordedEntry[]>;
  /** Entries with intents still waiting in the queue. */
  pending: ReadonlyMap<string, NutritionEntryPendingState>;
  /** This account's rejected offline changes, one per entry. */
  conflicts: NutritionEntryConflict[];
}

const subscribeQueue = (onChange: () => void) => {
  window.addEventListener(QUEUE_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(QUEUE_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

const NO_PENDING: ReadonlyMap<string, NutritionEntryPendingState> = new Map();

/** `committed`: a read of the entries dated `from`..`to` inclusive. */
export const useNutritionV2EntryOverlay = (
  committed: NutritionV2Read<RecordedEntry[]>,
  from: NutritionDate | null | undefined,
  to: NutritionDate | null | undefined
): NutritionV2EntryOverlay => {
  const access = useNutritionV2Access();
  const uid = access.status === "eligible" ? access.uid : null;
  // The stored queue as it is, without the repairs `loadQueue` makes: read
  // during render, so it must not write.
  const rawQueue = useSyncExternalStore(subscribeQueue, peekQueueStorage, () => null);
  const handoffVersion = useSyncExternalStore(subscribeNutritionHandoff, getNutritionHandoffVersion, getNutritionHandoffVersion);

  const queue = useMemo(() => readOwnerNutritionQueue(parseQueueStorage(rawQueue), uid), [rawQueue, uid]);
  const committedEntries = committed.status === "success" ? committed.data : null;

  const projection = useMemo(() => {
    if (uid === null || committedEntries === null || !from || !to) return null;
    return projectNutritionEntries({
      committed: committedEntries,
      handoff: nutritionHandoffFor(uid),
      queued: queue.active,
      covers: (date) => from <= date && date <= to,
    });
    // handoffVersion: the handed-off intents are module state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, committedEntries, queue, from, to, handoffVersion]);

  // A server read that shows a handed-off intent settles it.
  useEffect(() => {
    if (uid === null || committedEntries === null || !from || !to) return;
    settleNutritionHandoff(uid, committedEntries, (date) => from <= date && date <= to);
  }, [uid, committedEntries, from, to]);

  const conflicts = useMemo(() => groupNutritionConflicts(queue.rejected), [queue]);

  return {
    entries: projection ? { status: "success", data: projection.entries } : committed,
    pending: projection?.pending ?? NO_PENDING,
    conflicts,
  };
};
