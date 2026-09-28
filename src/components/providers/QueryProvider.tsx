import React, { useEffect, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useAuth } from '@/hooks/useAuth';
import { accountStorageKey } from '@/lib/accountIdentity';
import { createAccountPersister, invalidateRestoredQueries, shouldPersistQuery } from '@/lib/queryPersistence';

export function QueryProvider({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    return <AccountQueryProvider key={user?.uid ?? 'signed-out'} ownerUid={user?.uid ?? null}>
        {children}
    </AccountQueryProvider>;
}

function AccountQueryProvider({ children, ownerUid }: { children: React.ReactNode; ownerUid: string | null }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: { gcTime: 1000 * 60 * 60 * 24, staleTime: 1000 * 60 * 5, retry: 1 },
        },
    }));
    const [persister] = useState(() => createAccountPersister({
        storage: ownerUid ? window.localStorage : undefined,
        key: ownerUid ? accountStorageKey('REACT_QUERY_OFFLINE_CACHE', ownerUid) : undefined,
    }));

    useEffect(() => () => {
        void queryClient.cancelQueries();
    }, [queryClient]);

    // A reload, a closed tab or a backgrounded app must not lose the last
    // change: write the waiting snapshot before the page goes away.
    useEffect(() => {
        const flushWhenHidden = () => {
            if (document.visibilityState === 'hidden') persister.flush();
        };
        window.addEventListener('pagehide', persister.flush);
        document.addEventListener('visibilitychange', flushWhenHidden);
        return () => {
            window.removeEventListener('pagehide', persister.flush);
            document.removeEventListener('visibilitychange', flushWhenHidden);
            persister.flush();
        };
    }, [persister]);

    return <PersistQueryClientProvider client={queryClient} persistOptions={{
        persister,
        buster: 'account-owned-v1',
        // Nutrition generation and suggestion reads are never persisted.
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    }}
    // Restored reads are shown at once but are not the authority: refetch them.
    onSuccess={() => invalidateRestoredQueries(queryClient)}>{children}</PersistQueryClientProvider>;
}
