// ============================================
// Plugin Fetch Handler
//
// プラグインからの fetch リクエストを安全に処理します。
// ホワイトリスト方式で URL を検証し、許可されたドメインのみアクセス可能にします。
// ============================================

/**
 * 本番環境で安全に使える最小限のドメインリスト。
 * 一般的な用途に使用する場合はこちらを基準にしてください。
 */
export const PRODUCTION_ALLOWED_DOMAINS = ['api.github.com', 'cdn.jsdelivr.net', 'unpkg.com'];

/**
 * 開発・デモ用の追加ドメインリスト。
 * PRODUCTION_ALLOWED_DOMAINS に加えて、デモや学習用の API が含まれます。
 */
export const DEMO_ALLOWED_DOMAINS = [
    ...PRODUCTION_ALLOWED_DOMAINS,
    'api.openweathermap.org',
    'jsonplaceholder.typicode.com',
    'pokeapi.co',
    'dog.ceo',
    'catfact.ninja',
];

/**
 * デフォルトのURL許可リスト。
 * 本番向けの最小限セットです。カスタマイズしたい場合は `createPluginFetchHandler` に渡してください。
 */
export const DEFAULT_ALLOWED_DOMAINS = PRODUCTION_ALLOWED_DOMAINS;

/**
 * URL がホワイトリストに含まれているか検証します
 */
export function isUrlAllowed(url: string, allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS): boolean {
    try {
        const urlObj = new URL(url);

        // HTTPS のみ許可
        if (urlObj.protocol !== 'https:') {
            console.warn(`[FetchHandler] HTTPS ではない URL は許可されていません: ${url}`);
            return false;
        }

        // ホワイトリストチェック（完全一致またはサブドメイン一致）
        const isAllowed = allowedDomains.some((domain) => {
            return urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`);
        });

        if (!isAllowed) {
            console.warn(`[FetchHandler] ホワイトリストに含まれていないドメイン: ${urlObj.hostname}`);
        }

        return isAllowed;
    } catch (error) {
        console.error('[FetchHandler] 無効な URL:', url, error);
        return false;
    }
}

/**
 * プラグイン用の安全な fetch ハンドラを作成します
 *
 * @param allowedDomains 許可するドメインのリスト（デフォルト: PRODUCTION_ALLOWED_DOMAINS）
 * @returns fetch ハンドラ関数
 *
 * @example
 * ```ts
 * // 本番: デフォルト（最小限）
 * const fetchHandler = createPluginFetchHandler();
 *
 * // デモ・開発: より多くのドメインを許可
 * import { DEMO_ALLOWED_DOMAINS } from '@ubichill/sdk';
 * const fetchHandler = createPluginFetchHandler(DEMO_ALLOWED_DOMAINS);
 *
 * // カスタム
 * const fetchHandler = createPluginFetchHandler(['api.myservice.com']);
 *
 * const manager = new PluginHostManager(workerUrl, {
 *   handlers: { onFetch: fetchHandler },
 * });
 * ```
 */
export function createPluginFetchHandler(allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS) {
    return async (
        url: string,
        options?: {
            method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
            headers?: Record<string, string>;
            body?: string;
        },
    ): Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
    }> => {
        if (!isUrlAllowed(url, allowedDomains)) {
            return {
                ok: false,
                status: 403,
                statusText: 'Forbidden',
                headers: {},
                body: JSON.stringify({
                    error: 'このURLへのアクセスは許可されていません',
                    allowedDomains,
                }),
            };
        }

        try {
            const response = await fetch(url, {
                method: options?.method ?? 'GET',
                headers: options?.headers,
                body: options?.body,
            });

            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });

            const body = await response.text();

            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers,
                body,
            };
        } catch (error) {
            console.error('[FetchHandler] フェッチエラー:', error);
            return {
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                headers: {},
                body: JSON.stringify({
                    error: error instanceof Error ? error.message : 'Unknown error',
                }),
            };
        }
    };
}
