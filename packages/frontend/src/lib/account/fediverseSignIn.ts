import {
    type FediverseSignInIntent,
    type FediverseSignUpCandidate,
    fediverseSignInErrorMessage,
    type LoginMethods,
} from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, requestApi } from '@/lib/api';

const authUrl = (path: string) => `${API_BASE}/api/auth${path}`;

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(authUrl(path), {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok) {
        throw new Error(fediverseSignInErrorMessage(body.code ?? null) ?? body.message ?? '通信に失敗しました');
    }
    return body as T;
}

/** 認証サーバーの同意画面へ移る。戻り先は Ubichill 内の相対 URL。 */
export async function startFediverseSignIn(input: {
    server: string;
    intent: FediverseSignInIntent;
    returnTo: string;
}): Promise<void> {
    const { url } = await authRequest<{ url: string }>('/fediverse/start', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    window.location.assign(url);
}

export async function fetchFediverseSignInOptions(): Promise<{ enabled: boolean; registrationOpen: boolean }> {
    return authRequest('/fediverse/options');
}

export async function fetchFediverseSignUpCandidate(): Promise<FediverseSignUpCandidate> {
    return authRequest('/fediverse/sign-up');
}

export async function completeFediverseSignUp(input: { handle: string; displayName: string }): Promise<string> {
    const { returnTo } = await authRequest<{ returnTo: string }>('/fediverse/sign-up', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    return returnTo;
}

export async function fetchLoginMethods(): Promise<LoginMethods> {
    return requestApi('/users/me/login-methods');
}

export async function removeLoginMethod(id: string): Promise<void> {
    await requestApi(`/users/me/login-methods/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 自分のログイン方法。読み込めなければ null のまま（パスワードの欄は出す）。 */
export function useLoginMethods(enabled: boolean): { methods: LoginMethods | null; reload: () => void } {
    const [methods, setMethods] = useState<LoginMethods | null>(null);
    const reload = useCallback(() => {
        fetchLoginMethods()
            .then(setMethods)
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        if (enabled) reload();
    }, [enabled, reload]);
    return { methods, reload };
}
