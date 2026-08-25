import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            gcTime: 1000 * 60 * 60 * 24, // 24 hours
            staleTime: 1000 * 60 * 5, // 5 minutes
            retry: 1,
        },
    },
});

const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: 'REACT_QUERY_OFFLINE_CACHE',
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
    return (
        <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister }}
            onSuccess={() => {
                if (import.meta.env.DEV) {
                    const cache = queryClient.getQueryCache().getAll();
                    if (import.meta.env.DEV) {
                        console.log(`[QueryProvider] Cache restored. Queries: ${cache.length}`, cache.map(q => q.queryKey));
                    }
                }
            }}
        >
            {children}
        </PersistQueryClientProvider>
    );
}
