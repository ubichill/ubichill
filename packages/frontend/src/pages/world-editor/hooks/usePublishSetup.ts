import { useCallback, useState } from 'react';
import type { MyAccount } from '@/lib/account/me';
import type { PublishReadiness, WorldSigner } from '@/lib/signing';

export type PublishDecision = { kind: 'signed'; signer: WorldSigner } | { kind: 'cancel' };

export interface PendingPublishSetup {
    readiness: Exclude<PublishReadiness, { kind: 'ready' }>;
    account: MyAccount | null;
    finish: (decision: PublishDecision) => void;
}

/**
 * 公開するときに準備が足りなければ、公開の準備ダイアログを開いて利用者の操作を待つ。
 * `request` は「署名して公開」か「キャンセル」で解決する Promise を返す（下書き保存はダイアログを通らない）。
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
