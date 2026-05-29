import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface WorkerLoadingContextType {
    registerWorker: () => { markReady: () => void; unregister: () => void };
}

export const WorkerLoadingContext = createContext<WorkerLoadingContextType | null>(null);

export function useWorkerLoading() {
    return useContext(WorkerLoadingContext);
}

export const WorkerLoadingProvider: React.FC<{
    children: React.ReactNode;
    onStatusChange?: (pendingCount: number) => void;
}> = ({ children, onStatusChange }) => {
    const [pendingCount, setPendingCount] = useState(0);

    // Context changes immediately notify the parent via prop
    useEffect(() => {
        onStatusChange?.(pendingCount);
    }, [pendingCount, onStatusChange]);

    const registerWorker = useCallback(() => {
        setPendingCount((c) => c + 1);
        let ready = false;
        return {
            markReady: () => {
                if (!ready) {
                    ready = true;
                    setPendingCount((c) => c - 1);
                }
            },
            unregister: () => {
                if (!ready) {
                    ready = true;
                    setPendingCount((c) => c - 1);
                }
            },
        };
    }, []);

    const contextValue = useMemo(() => ({ registerWorker }), [registerWorker]);

    return <WorkerLoadingContext.Provider value={contextValue}>{children}</WorkerLoadingContext.Provider>;
};
