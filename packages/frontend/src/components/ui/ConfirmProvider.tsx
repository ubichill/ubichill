import { createContext, useContext, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { createConfirmGate } from './confirmGate';

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => true);

/**
 * 画面遷移など取り消しの効かない操作の前に確認モーダルを出すための共通フック。
 * `const confirm = useConfirm(); if (await confirm('移動しますか？')) navigate(...)` の形で使う。
 * 確認が出ている間に別の確認が来たら、前の確認を false で閉じて新しい方を出す。
 */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [message, setMessage] = useState<string | null>(null);
    const [gate] = useState(() => createConfirmGate(setMessage));

    return (
        <ConfirmContext.Provider value={gate.ask}>
            {children}
            <ConfirmModal
                isOpen={message !== null}
                message={message ?? ''}
                onConfirm={() => gate.settle(true)}
                onCancel={() => gate.settle(false)}
            />
        </ConfirmContext.Provider>
    );
}
