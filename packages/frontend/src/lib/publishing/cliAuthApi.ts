import { API_BASE } from '@/lib/api';
import { errorCode, errorMessage } from '@/lib/apiError';

/** 承認画面に見せる CLI・CI の認可の要求（秘密は含まない）。 */
export interface CliAuthRequestView {
    id: string;
    kind: 'cli' | 'ci';
    name: string;
    publicKey: string;
    flow: 'loopback' | 'device';
    redirectHost: string | null;
    userCode: string | null;
    status: string;
    expiresAt: string;
}

export async function fetchCliAuthRequest(
    query: { requestId: string } | { userCode: string },
): Promise<CliAuthRequestView> {
    const url =
        'requestId' in query
            ? `${API_BASE}/api/v1/cli-auth/requests/${encodeURIComponent(query.requestId)}`
            : `${API_BASE}/api/v1/cli-auth/requests?userCode=${encodeURIComponent(query.userCode)}`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { request: CliAuthRequestView }).request;
}

/**
 * 承認する。ループバックなら CLI へ戻るリダイレクト先が返る。直近の本人確認が要る（ログインかパスワードの確認から
 * 10 分を過ぎた）ときは 'reauth-required'。
 */
export async function approveCliAuthRequest(
    id: string,
    state: string | null,
): Promise<{ redirect: string | null } | 'reauth-required'> {
    const res = await fetch(`${API_BASE}/api/v1/cli-auth/requests/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(state ? { state } : {}),
    });
    if (res.status === 403 && (await errorCode(res.clone())) === 'reauth-required') return 'reauth-required';
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as { redirect: string | null };
}
