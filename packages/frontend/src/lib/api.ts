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
