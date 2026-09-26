import { auth } from '@/lib/firebase';
import { AccountChangedError } from '@/lib/accountIdentity';
import { handlers } from '@/lib/offlineHandlers';
import {
  assertQueueClaim, claimEntry, hasRejectedDependency, isReplayEligible, loadQueue, notifyEntryReplayed,
  quarantineDependentEntry, quarantineRejectedEntry, removeEntry, updateEntry,
  MAX_RETRY_DELAY_MS, QueueClaimLostError, QueueStorageError, ReplayRejectedError,
} from '@/lib/offlineQueue';

// Shared by ALL hook instances. React state/ref timing cannot serialize workers.
let flushing = false;

export interface ReplayResult {
  completed: number;
  failed: number;
  /** Entries set aside for good in this run: rejected, or depending on a rejected one. */
  quarantined: number;
  storageError?: QueueStorageError;
}

export async function flushOfflineQueue(
  ownerUid: string,
  invalidate: (keys: readonly (readonly unknown[])[]) => void,
): Promise<ReplayResult> {
  const result: ReplayResult = { completed: 0, failed: 0, quarantined: 0 };
  if (flushing || auth.currentUser?.uid !== ownerUid) return result;
  flushing = true;
  const run = async () => {
    for (const snapshot of loadQueue()) {
      if (auth.currentUser?.uid !== ownerUid) break;
      const fresh = loadQueue().find(entry => entry.id === snapshot.id);
      if (!fresh || fresh.ownerUid !== ownerUid || fresh.status === 'quarantined') continue;
      // It assumes a change that was rejected, so it is rejected too - never
      // written against a state it was not made for.
      if (hasRejectedDependency(fresh, loadQueue())) {
        quarantineDependentEntry(fresh);
        result.quarantined++;
        continue;
      }
      // Preserve intent order: an older uncertain write must settle before later edits.
      if (!isReplayEligible(fresh)) break;
      const entry = claimEntry(fresh.id, ownerUid);
      if (!entry) break;
      try {
        const checkpoint = () => assertQueueClaim(entry);
        checkpoint();
        const handler = handlers[entry.type];
        if (!handler) throw new Error(`No handler for type ${entry.type}`);
        const keys = await handler(entry.payload as never, ownerUid, checkpoint);
        checkpoint();
        // Cleanup failure leaves the durable claim intact. Never report completion.
        removeEntry(entry.id);
        // Before invalidation: optimistic views keep showing the change until
        // the refetch this starts has the server's copy.
        notifyEntryReplayed(entry);
        result.completed++;
        invalidate(keys);
      } catch (error) {
        if (error instanceof QueueStorageError) throw error;
        if (error instanceof QueueClaimLostError) break;
        const current = loadQueue().find(item => item.id === entry.id);
        if (current?.claimId !== entry.claimId) break;
        if (error instanceof AccountChangedError) {
          updateEntry(entry.id, { status: 'pending', claimId: undefined, leaseUntil: undefined });
          break;
        }
        // Terminal: the same answer on every attempt. Keep the entry, set it
        // aside with its reason, refetch what it names, and go on - later
        // entries do not wait behind a write that can never apply.
        if (error instanceof ReplayRejectedError) {
          // Only the owner's session may set its entry aside.
          if (auth.currentUser?.uid !== ownerUid) {
            updateEntry(entry.id, { status: 'pending', claimId: undefined, leaseUntil: undefined });
            break;
          }
          const dependents = quarantineRejectedEntry(entry, error.rejection);
          result.quarantined += 1 + dependents.length;
          invalidate(error.invalidate);
          continue;
        }
        const attempts = Math.min((entry.attempts || 0) + 1, 10);
        updateEntry(entry.id, {
          status: 'failed', attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: Date.now() + Math.min(1000 * 2 ** (attempts - 1), MAX_RETRY_DELAY_MS),
          claimId: undefined, leaseUntil: undefined,
        });
        result.failed++;
        break;
      }
    }
  };
  try {
    // Serialize live replay tabs where available; durable leases survive tab death.
    if (navigator.locks) {
      await navigator.locks.request('fitssai-offline-replay', { ifAvailable: true }, async lock => {
        if (lock) await run();
      });
    } else {
      await run();
    }
  } catch (error) {
    if (!(error instanceof QueueStorageError)) throw error;
    result.storageError = error;
  } finally {
    flushing = false;
  }
  return result;
}
