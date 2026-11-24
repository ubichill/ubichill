import { apiErrorOf } from './apiError';

/**
 * バックエンドAPIのベースURLを返す。
 *
 * Vite (CSR のみ) のため SSR ブランチは不要。
 *
 * - VITE_BACKEND_URL: 明示的にバックエンドURLを指定する場合
 * - 未設定 / localhost: http://localhost:3001 にフォールバック
 * - k8s: window.location.origin にフォールバックし、Ingress が /api をバックエンドにルーティング
 *
 * VITE_* はビルド時に埋め込まれる。
 */
export function getApiBase(): string {
    const localhostFallback =
        window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin;
    return import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || localhostFallback;
}

export const API_BASE = getApiBase();

/** 自分の API（`/api/v1` から下の path）を cookie 付きで呼び、JSON を返す（204 は undefined）。失敗は ApiError で投げる。 */
export async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) throw await apiErrorOf(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
}
