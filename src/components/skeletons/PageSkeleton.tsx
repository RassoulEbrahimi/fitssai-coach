import React from 'react';
import { Loader2 } from 'lucide-react';

const PageSkeleton = () => {
    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-background space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Laden...</p>
        </div>
    );
};

export default PageSkeleton;
