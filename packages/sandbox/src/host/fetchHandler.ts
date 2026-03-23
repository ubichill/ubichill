export const PRODUCTION_ALLOWED_DOMAINS = ['api.github.com', 'cdn.jsdelivr.net', 'unpkg.com'];

export const DEMO_ALLOWED_DOMAINS = [
    ...PRODUCTION_ALLOWED_DOMAINS,
    'api.openweathermap.org',
    'jsonplaceholder.typicode.com',
    'pokeapi.co',
    'dog.ceo',
    'catfact.ninja',
];

export const DEFAULT_ALLOWED_DOMAINS = PRODUCTION_ALLOWED_DOMAINS;

export function isUrlAllowed(url: string, allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS): boolean {
    try {
        const urlObj = new URL(url);
        if (urlObj.protocol !== 'https:') {
            console.warn(`[FetchHandler] HTTPS ではない URL は許可されていません: ${url}`);
            return false;
        }
        const isAllowed = allowedDomains.some(
            (domain) => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`),
        );
        if (!isAllowed) {
            console.warn(`[FetchHandler] ホワイトリストに含まれていないドメイン: ${urlObj.hostname}`);
        }
        return isAllowed;
    } catch (error) {
        console.error('[FetchHandler] 無効な URL:', url, error);
        return false;
    }
}

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
                body: JSON.stringify({ error: 'このURLへのアクセスは許可されていません', allowedDomains }),
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
            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers,
                body: await response.text(),
            };
        } catch (error) {
            console.error('[FetchHandler] フェッチエラー:', error);
            return {
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                headers: {},
                body: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            };
        }
    };
}
