import { createContext, useCallback, useContext, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => true);

/**
 * 画面遷移など取り消しの効かない操作の前に確認モーダルを出すための共通フック。
 * `const confirm = useConfirm(); if (await confirm('移動しますか？')) navigate(...)` の形で使う。
 */
export const useConfirm = () => useContext(ConfirmContext);

interface PendingConfirm {
    message: string;
    resolve: (result: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback<ConfirmFn>(
        (message) => new Promise<boolean>((resolve) => setPending({ message, resolve })),
        [],
    );

    const finish = useCallback(
        (result: boolean) => {
            pending?.resolve(result);
            setPending(null);
        },
        [pending],
    );

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <ConfirmModal
                isOpen={pending !== null}
                message={pending?.message ?? ''}
                onConfirm={() => finish(true)}
                onCancel={() => finish(false)}
            />
        </ConfirmContext.Provider>
    );
}
