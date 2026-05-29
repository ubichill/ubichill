import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** Worker 起動の進捗。total = マウント済み worker 数 / ready = 起動完了した worker 数 */
export interface WorkerLoadingStatus {
    ready: number;
    total: number;
}

interface WorkerLoadingContextType {
    registerWorker: () => { markReady: () => void; unregister: () => void };
}

export const WorkerLoadingContext = createContext<WorkerLoadingContextType | null>(null);

export function useWorkerLoading() {
    return useContext(WorkerLoadingContext);
}

export const WorkerLoadingProvider: React.FC<{
    children: React.ReactNode;
    onStatusChange?: (status: WorkerLoadingStatus) => void;
}> = ({ children, onStatusChange }) => {
    const [status, setStatus] = useState<WorkerLoadingStatus>({ ready: 0, total: 0 });

    // Context changes immediately notify the parent via prop
    useEffect(() => {
        onStatusChange?.(status);
    }, [status, onStatusChange]);

    const registerWorker = useCallback(() => {
        setStatus((s) => ({ ...s, total: s.total + 1 }));
        let ready = false;
        let done = false;
        return {
            markReady: () => {
                if (done || ready) return;
                ready = true;
                setStatus((s) => ({ ...s, ready: s.ready + 1 }));
            },
            // アンマウント時: 起動完了前なら total から外し、完了済みなら ready も戻す。
            // これにより pending(= total - ready) は常に正しく保たれる。
            unregister: () => {
                if (done) return;
                done = true;
                setStatus((s) => ({ ready: ready ? s.ready - 1 : s.ready, total: s.total - 1 }));
            },
        };
    }, []);

    const contextValue = useMemo(() => ({ registerWorker }), [registerWorker]);

    return <WorkerLoadingContext.Provider value={contextValue}>{children}</WorkerLoadingContext.Provider>;
};
