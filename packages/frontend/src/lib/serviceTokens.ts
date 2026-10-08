import type { RequestServiceToken } from '@ubichill/react';
import { type RpcIdentityTokenResult, UbiError, UbiErrorCode } from '@ubichill/shared';
import { API_BASE } from './api';

/** Ubichill のサーバーにサービストークンを依頼する（ログイン中のセッションで）。 */
export const requestServiceToken: RequestServiceToken = async ({ audience, modId, signal }) => {
    const res = await fetch(`${API_BASE}/api/v1/service-tokens`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience, modId }),
        signal,
    });
    if (res.status === 401) {
        throw new UbiError(
            UbiErrorCode.IDENTITY_UNAVAILABLE,
            'ログインすると使えます（ゲストでは身元証明を出せません）',
        );
    }
    if (res.status === 503) {
        throw new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, 'このサーバーは身元証明を発行していません');
    }
    if (res.status === 400) {
        throw new UbiError(UbiErrorCode.IDENTITY_AUDIENCE_INVALID, '宛先のサービスのオリジンが不正です');
    }
    if (!res.ok) {
        throw new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, `身元証明を受け取れませんでした (${res.status})`);
    }
    return (await res.json()) as RpcIdentityTokenResult;
};
