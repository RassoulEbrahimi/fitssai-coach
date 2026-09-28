import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Which cached queries the account's persisted cache may keep (NUT-07).
 *
 * Everything the default would keep — every successful query — except the
 * Nutrition query families that are ephemeral or sensitive: plan-generation
 * requests and replacement suggestions. They are recognised by the key
 * registry's own prefixes for the key's account, never by matching strings.
 * Recorded entries and every Training family persist exactly as before.
 */

/** The key families that are never written to the persisted cache, for the key's own account. */
const ephemeralPrefixes = (userId: string | undefined): readonly QueryKey[] => [
    queryKeys.nutrition.generation.all(userId),
    queryKeys.nutrition.suggestionsAll(userId),
];

const startsWith = (key: QueryKey, prefix: QueryKey): boolean =>
    prefix.length <= key.length && prefix.every((part, index) => part === key[index]);

export const isEphemeralQueryKey = (key: QueryKey): boolean => {
    const owner = typeof key[1] === 'string' ? key[1] : undefined;
    return ephemeralPrefixes(owner).some((prefix) => startsWith(key, prefix));
};

/**
 * The persister's `shouldDehydrateQuery`. Structural on purpose: the persister
 * dehydrates with its own copy of query-core, so its `Query` is not this
 * package's type. `status === 'success'` is TanStack's own default.
 */
export const shouldPersistQuery = (query: { queryKey: QueryKey; state: { status: string } }): boolean =>
    query.state.status === 'success' && !isEphemeralQueryKey(query.queryKey);

/** How often, at most, the account's cache is serialised to storage while the page is open. */
export const PERSIST_THROTTLE_MS = 1000;

export interface AccountPersister extends Persister {
    /** Write the latest pending snapshot now, synchronously. Nothing pending: nothing written. */
    flush: () => void;
}

/**
 * The account's cache persister: `createSyncStoragePersister`'s storage format
 * and restore, with a save that can be flushed (NUT-13B-FIX-01).
 *
 * Every cache change hands the persister a fresh snapshot, but serialising the
 * whole account cache on every change is too expensive, so saves are
 * throttled: the latest snapshot is written at most once per
 * `PERSIST_THROTTLE_MS`. A snapshot still waiting when the page is left would
 * be lost, and the next load would restore the state from before the last
 * change — a recording, a replacement, a profile save. `flush` writes the
 * waiting snapshot at once; the provider calls it when the page is hidden or
 * unloaded. It only ever writes a snapshot the persist subscription produced,
 * never one taken while the cache is still being restored.
 *
 * Without storage (signed out) nothing is stored or restored.
 */
export const createAccountPersister = ({ storage, key }: { storage: Storage | undefined; key: string | undefined }): AccountPersister => {
    const base = createSyncStoragePersister({ storage, key });
    if (!storage || !key) return { ...base, flush: () => undefined };

    let pending: PersistedClient | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        const snapshot = pending;
        pending = null;
        if (!snapshot) return;
        try {
            storage.setItem(key, JSON.stringify(snapshot));
        } catch {
            /* Full or blocked storage: the cache is an acceleration, never required. */
        }
    };

    return {
        persistClient: (client) => {
            pending = client;
            if (timer === null) timer = setTimeout(flush, PERSIST_THROTTLE_MS);
        },
        restoreClient: base.restoreClient,
        removeClient: () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            pending = null;
            return base.removeClient();
        },
        flush,
    };
};

/**
 * Called once the persisted cache has been restored, before any query
 * observer subscribes (NUT-13B-FIX-01).
 *
 * The server is the authority; the persisted cache only lets the app render
 * at once and offline. A restored read carries the time it was fetched, so
 * within `staleTime` it would count as fresh and never be refetched — even
 * when the server has changed since, on this device or another. So every
 * restored read is marked stale here, without fetching and without removing
 * its data: an observer that mounts renders the restored data and refetches
 * it in the background; offline that fetch waits for the network and the
 * restored data stays on screen.
 */
export const invalidateRestoredQueries = (queryClient: QueryClient): Promise<void> =>
    queryClient.invalidateQueries({ refetchType: 'none' });
