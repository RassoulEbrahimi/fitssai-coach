import type { QueryKey } from '@tanstack/react-query';
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
