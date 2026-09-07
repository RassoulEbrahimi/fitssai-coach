import React, { useEffect, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { useAuth } from '@/hooks/useAuth';
import { accountStorageKey } from '@/lib/accountIdentity';

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
    const [persister] = useState(() => createSyncStoragePersister({
        storage: ownerUid ? window.localStorage : undefined,
        key: ownerUid ? accountStorageKey('REACT_QUERY_OFFLINE_CACHE', ownerUid) : undefined,
    }));

    useEffect(() => () => {
        void queryClient.cancelQueries();
    }, [queryClient]);

    return <PersistQueryClientProvider client={queryClient} persistOptions={{
        persister,
        buster: 'account-owned-v1',
    }}>{children}</PersistQueryClientProvider>;
}
