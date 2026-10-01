import { useCallback, useState } from 'react';
import type { MyAccount } from '@/lib/account/me';
import type { PublishReadiness } from '@/lib/signing';

export type PublishDecision = { kind: 'continue'; account: MyAccount } | { kind: 'cancel' };

export interface PendingPublishSetup {
    readiness: Exclude<PublishReadiness, { kind: 'ready' }>;
    finish: (decision: PublishDecision) => void;
}

/**
 * 公開するときに足りないもの（ID）があれば、公開の準備ダイアログを開いて利用者の操作を待つ。
 * `request` は「続けて公開」か「キャンセル」で解決する Promise を返す（下書き保存はダイアログを通らない）。
 */
export function usePublishSetup() {
    const [pending, setPending] = useState<PendingPublishSetup | null>(null);

    const request = useCallback(
        (readiness: PendingPublishSetup['readiness']) =>
            new Promise<PublishDecision>((resolve) => {
                setPending({
                    readiness,
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
