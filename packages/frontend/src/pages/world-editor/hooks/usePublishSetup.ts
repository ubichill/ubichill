import { useCallback, useState } from 'react';
import type { MyAccount } from '@/lib/account/me';
import type { PublishReadiness } from '@/lib/signing';

export type PublishDecision = { kind: 'continue'; account: MyAccount } | { kind: 'cancel' };

export interface PendingPublishSetup {
    readiness: Exclude<PublishReadiness, { kind: 'ready' }>;
    /** 公開するのか、下書きを保存するのか（どちらも ID が要る。URL になるため）。 */
    purpose: 'publish' | 'save';
    finish: (decision: PublishDecision) => void;
}

/**
 * 保存・公開するときに足りないもの（ID）があれば、準備ダイアログを開いて利用者の操作を待つ。
 * `request` は「続ける」か「キャンセル」で解決する Promise を返す。
 */
export function usePublishSetup() {
    const [pending, setPending] = useState<PendingPublishSetup | null>(null);

    const request = useCallback(
        (readiness: PendingPublishSetup['readiness'], purpose: PendingPublishSetup['purpose'] = 'publish') =>
            new Promise<PublishDecision>((resolve) => {
                setPending({
                    readiness,
                    purpose,
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
