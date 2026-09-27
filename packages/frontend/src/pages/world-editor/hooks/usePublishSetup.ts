import { useCallback, useState } from 'react';
import type { MyAccount } from '@/lib/account/me';
import type { PublishReadiness, WorldSigner } from '@/lib/signing';

export type PublishDecision = { kind: 'signed'; signer: WorldSigner } | { kind: 'private' } | { kind: 'cancel' };

export interface PendingPublishSetup {
    readiness: Exclude<PublishReadiness, { kind: 'ready' }>;
    account: MyAccount | null;
    finish: (decision: PublishDecision) => void;
}

/**
 * 保存時にそのまま公開できないとき、公開の準備ダイアログを開いて利用者の選択を待つ。
 * `request` は選択（署名して公開 / 非公開で保存 / キャンセル）で解決する Promise を返す。
 */
export function usePublishSetup() {
    const [pending, setPending] = useState<PendingPublishSetup | null>(null);

    const request = useCallback(
        (readiness: PendingPublishSetup['readiness'], account: MyAccount | null) =>
            new Promise<PublishDecision>((resolve) => {
                setPending({
                    readiness,
                    account,
                    finish: (decision) => {
                        setPending(null);
                        resolve(decision);
                    },
                });
            }),
        [],
    );

    return { request, pending };
}
