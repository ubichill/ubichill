import {
    FEDIVERSE_SIGN_IN_ERRORS,
    type FediverseServerInfo,
    type FediverseSignInIntent,
    type FediverseSignUpCandidate,
    isFediverseSignInError,
    type LoginMethods,
} from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, requestApi } from '@/lib/api';

/** 認証の API の失敗。`code` は shared の FEDIVERSE_SIGN_IN_ERRORS のキー（本人確認が要るかの判定などに使う）。 */
export class FediverseRequestError extends Error {
    constructor(
        message: string,
        readonly code: string | null,
    ) {
        super(message);
    }
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/auth${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new FediverseRequestError('Ubichill に接続できませんでした。ネットワークを確かめてください', null);
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok) {
        const code = body.code ?? null;
        // 理由のコードが無い失敗（古い backend・中継の不調など）は、状態の番号を添えて出す
        if (res.status === 429) {
            throw new FediverseRequestError('操作が多すぎます。しばらくしてからお試しください', 'rate-limited');
        }
        throw new FediverseRequestError(
            isFediverseSignInError(code)
                ? FEDIVERSE_SIGN_IN_ERRORS[code]
                : `うまくいきませんでした。時間をおいてもう一度お試しください（HTTP ${res.status}${code ? ` ${code}` : ''}）`,
            code,
        );
    }
    return body as T;
}

/** 認証サーバーの同意画面へ移る。戻り先は Ubichill 内の相対 URL。 */
export async function startFediverseSignIn(input: {
    server: string;
    intent: FediverseSignInIntent;
    prefer?: 'sign-in' | 'sign-up';
    returnTo: string;
}): Promise<void> {
    const { url } = await authRequest<{ url: string }>('/fediverse/start', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    window.location.assign(url);
}

export async function lookupFediverseServer(server: string, signal?: AbortSignal): Promise<FediverseServerInfo> {
    return authRequest(`/fediverse/lookup?server=${encodeURIComponent(server)}`, { signal });
}

export interface FediverseSignInOptions {
    enabled: boolean;
    registrationOpen: boolean;
    featuredServers: string[];
}

export async function fetchFediverseSignInOptions(): Promise<FediverseSignInOptions> {
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

/** 登録をやめる（途中の状態を消す。共用の端末で別の人が続きから登録できないように）。 */
export async function cancelFediverseSignUp(): Promise<void> {
    await authRequest('/fediverse/sign-up', { method: 'DELETE' }).catch(() => undefined);
}

export async function fetchLoginMethods(): Promise<LoginMethods> {
    return requestApi('/users/me/login-methods');
}

export async function removeLoginMethod(id: string): Promise<void> {
    await requestApi(`/users/me/login-methods/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** パスワードで本人確認をし直す（ログイン方法の変更・管理者の操作の前に）。 */
export async function reauthenticate(password: string): Promise<void> {
    await requestApi('/users/me/reauthenticate', { method: 'POST', body: JSON.stringify({ password }) });
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

export type FediverseServerState =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'found'; server: FediverseServerInfo }
    | { state: 'error'; error: string; code: string | null };

/**
 * サーバーの公開情報を引く。`delayMs` は入力を打ち終わるまで待つ時間（並べたサーバーは 0）。
 * 前の問い合わせは取り消し、遅れて返った古い結果で上書きしない。
 */
export function useFediverseServer(input: string, delayMs: number): FediverseServerState {
    const [result, setResult] = useState<FediverseServerState>({ state: 'idle' });
    const latest = useRef(0);
    useEffect(() => {
        const query = input.trim();
        const id = ++latest.current;
        if (!query.includes('.') && !query.includes(':')) {
            setResult({ state: 'idle' });
            return;
        }
        setResult({ state: 'checking' });
        const controller = new AbortController();
        const timer = setTimeout(() => {
            lookupFediverseServer(query, controller.signal)
                .then((server) => {
                    if (id === latest.current) setResult({ state: 'found', server });
                })
                .catch((error: unknown) => {
                    if (id !== latest.current || controller.signal.aborted) return;
                    setResult({
                        state: 'error',
                        error: error instanceof Error ? error.message : '確認できませんでした',
                        code: error instanceof FediverseRequestError ? error.code : null,
                    });
                });
        }, delayMs);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [input, delayMs]);
    return result;
}
