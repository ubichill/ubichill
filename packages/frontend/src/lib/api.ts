/**
 * バックエンドAPIのベースURLを返す。
 *
 * - SSR (typeof window === 'undefined'):
 *     Pod → Pod の通信なので K8s 内部 Service DNS を使う。
 *     BACKEND_INTERNAL_URL → NEXT_PUBLIC_API_URL → http://localhost:3001
 *
 * - CSR (ブラウザ):
 *     NEXT_PUBLIC_BACKEND_URL → NEXT_PUBLIC_API_URL
 *     → window.location.origin（Ingress 経由で自動解決、k8s で build-args 不要）
 *     → http://localhost:3001（ローカル開発フォールバック）
 *
 * NEXT_PUBLIC_* はビルド時に埋め込まれるため、k8s ではビルド引数で渡す必要がある。
 * 渡さない場合は window.location.origin にフォールバックするため、
 * Ingress で /api を backend にルーティングしている構成であれば設定不要。
 */
export function getApiBase(): string {
    if (typeof window === 'undefined') {
        // SSR: Pod 内から別 Pod への通信
        return process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    }
    // CSR: ブラウザから Ingress 経由
    // localhost の場合はバックエンドが :3001 で動くためそちらへ向ける。
    // k8s では window.location.origin（Ingress が /api をバックエンドにルーティング）。
    const localhostFallback =
        window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin;
    return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || localhostFallback;
}

/**
 * モジュールスコープの定数として使いたい場合のエクスポート。
 * 'use client' ファイル（CSR のみ）で使用すること。
 * SSR が絡む場合は getApiBase() を直接呼ぶこと。
 */
export const API_BASE = getApiBase();
