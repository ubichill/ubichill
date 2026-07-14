/**
 * PermissionToastBridge — 診断（権限拒否など）を console 出力＋ユーザー向けトーストに橋渡しする。
 *
 * PermissionProvider の内側に置くことで、拒否トーストに「許可」ボタンを付けて
 * その場で grant に変えられる（retry 情報がある拒否のみ）。沈黙させない可視化も兼ねる。
 */
import { resetDiagnosticHandler, setDiagnosticHandler, useUbiPermissions } from '@ubichill/react';
import { UbiErrorCode } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { pushToast, type ToastAction } from '@/lib/toast';

/** ユーザーに見せる価値のある拒否コード（権限系）。 */
const USER_FACING_DENIAL = new Set<UbiErrorCode>([
    UbiErrorCode.CAPABILITY_DENIED,
    UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
]);

export function PermissionToastBridge() {
    const permissions = useUbiPermissions();
    // ハンドラを 1 度だけ登録するため、最新の permissions は ref 経由で読む。
    const permissionsRef = useRef(permissions);
    permissionsRef.current = permissions;

    useEffect(() => {
        setDiagnosticHandler(({ level, modId, code, message, retry }) => {
            console[level](`[Mod:${modId}] [${code}] ${message}`);
            if (!USER_FACING_DENIAL.has(code)) return;

            const p = permissionsRef.current;
            let action: ToastAction | undefined;
            if (p && retry) {
                // retry.modId は "mod:component" のことがあるので ":" 前に正規化。
                const name = retry.modId.split(':')[0];
                action =
                    'capability' in retry
                        ? { label: '許可', run: () => p.grantCapability(name, retry.capability) }
                        : { label: '許可', run: () => p.grantFetchDomain(name, retry.domain) };
            }
            pushToast(message, 'warn', action);
        });
        return () => resetDiagnosticHandler();
    }, []);

    return null;
}
