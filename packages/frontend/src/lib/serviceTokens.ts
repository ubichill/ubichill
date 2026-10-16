import type { RequestServiceToken } from '@ubichill/react';
import { type RpcIdentityTokenResult, UbiError, UbiErrorCode } from '@ubichill/shared';
import { API_BASE } from './api';

/**
 * 発行の失敗を、mod に返す UbiError にする（純粋）。`code` はサーバーが返す理由。
 * 宛先を直すべき失敗（IDENTITY_AUDIENCE_INVALID）と、それ以外（ログイン・署名・サーバーの都合）を分ける。
 */
export function serviceTokenErrorOf(status: number, code: unknown): UbiError {
    if (status === 401) {
        return new UbiError(
            UbiErrorCode.IDENTITY_UNAVAILABLE,
            'ログインすると使えます（ゲストでは身元証明を出せません）',
        );
    }
    if (status === 400 && code === 'audience-invalid') {
        return new UbiError(UbiErrorCode.IDENTITY_AUDIENCE_INVALID, '宛先のサービスのオリジンが不正です');
    }
    if (status === 400 || status === 403) {
        return new UbiError(
            UbiErrorCode.IDENTITY_UNAVAILABLE,
            'mod の作者署名を確認できないため、身元証明を出せません（mod を読み込み直してください）',
        );
    }
    if (status === 503 && code === 'author-pending') {
        return new UbiError(
            UbiErrorCode.IDENTITY_UNAVAILABLE,
            'いまは mod の作者を確認できません。時間をおいて試してください',
        );
    }
    if (status === 503) {
        return new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, 'このサーバーは身元証明を発行していません');
    }
    return new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, `身元証明を受け取れませんでした (${status})`);
}

/** Ubichill のサーバーにサービストークンを依頼する（ログイン中のセッションで）。 */
export const requestServiceToken: RequestServiceToken = async ({ audience, modId, authorProof, signal }) => {
    const res = await fetch(`${API_BASE}/api/v1/service-tokens`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience, modId, authorProof }),
        signal,
    });
    if (!res.ok) {
        const { code } = (await res.json().catch(() => ({}))) as { code?: unknown };
        throw serviceTokenErrorOf(res.status, code);
    }
    return (await res.json()) as RpcIdentityTokenResult;
};
