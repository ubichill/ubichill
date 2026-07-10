/**
 * プラグインの Ubi.fetch を Host 側で実行するハンドラ。
 *
 * 2 系統:
 *  - fetchDirect            : 相対 URL / プラグイン自身の origin 用。allowlist チェックなし。
 *  - createPluginFetchHandler: 外部 URL 用。allowlist (https + ドメイン) でガードする。
 *
 * エラーは machine-readable な `code` を含む構造化 body で返すため、プラグイン側は
 * `JSON.parse(res.body).error.code` で原因 (ドメイン拒否 / HTTPS必須 / …) を判別できる。
 */
import { type FetchOptions, type FetchResult, UbiErrorCode } from '@ubichill/shared';

const LOG_PREFIX = '[FetchHandler]';

/** HTTP ステータス (Host が合成して返すもの)。 */
const HTTP_STATUS = {
    FORBIDDEN: { status: 403, statusText: 'Forbidden' },
    INTERNAL_ERROR: { status: 500, statusText: 'Internal Server Error' },
} as const;

/**
 * エラー時に FetchResult.body に JSON 文字列として入る構造。
 * code は統一エラー体系 (UbiErrorCode) の FETCH_* を使う。
 */
export interface FetchErrorBody {
    error: {
        code: UbiErrorCode;
        message: string;
        /** FETCH_DOMAIN_NOT_ALLOWED のとき、許可されているドメイン一覧 */
        allowedDomains?: string[];
    };
}

// ============================================================
// allowlist ポリシー
//   NOTE: 本来これはアプリ固有のポリシーであり、consumer が
//   createPluginFetchHandler(domains) に注入するのが理想。
//   ここでは後方互換のためデフォルト値を提供している。
// ============================================================

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

// ============================================================
// 内部ヘルパー (重複排除)
// ============================================================

/** Response → FetchResult の変換 (成功・HTTP エラー問わず素通し)。 */
async function toFetchResult(response: Response): Promise<FetchResult> {
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
}

/** Host が合成するエラー FetchResult を作る。 */
function errorResult(http: { status: number; statusText: string }, error: FetchErrorBody['error']): FetchResult {
    return {
        ok: false,
        status: http.status,
        statusText: http.statusText,
        headers: {},
        body: JSON.stringify({ error } satisfies FetchErrorBody),
    };
}

/** 実際の fetch 実行 + 例外を NETWORK_ERROR の FetchResult に正規化。 */
async function runFetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    try {
        const response = await fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body,
        });
        return await toFetchResult(response);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`${LOG_PREFIX} フェッチ失敗: ${url}`, error);
        return errorResult(HTTP_STATUS.INTERNAL_ERROR, { code: UbiErrorCode.FETCH_NETWORK_ERROR, message });
    }
}

// ============================================================
// allowlist チェック (理由つき)
// ============================================================

type UrlCheck = { allowed: true } | { allowed: false; code: UbiErrorCode; message: string };

/** URL が allowlist を満たすか、満たさないなら理由コードつきで返す。 */
export function checkUrlAllowed(url: string, allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS): UrlCheck {
    let urlObj: URL;
    try {
        urlObj = new URL(url);
    } catch {
        return { allowed: false, code: UbiErrorCode.FETCH_INVALID_URL, message: `URL として不正です: ${url}` };
    }
    if (urlObj.protocol !== 'https:') {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_HTTPS_REQUIRED,
            message: `https 以外は許可されていません: ${urlObj.protocol}//`,
        };
    }
    const ok = allowedDomains.some((d) => urlObj.hostname === d || urlObj.hostname.endsWith(`.${d}`));
    if (!ok) {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
            message: `許可されていないドメインです: ${urlObj.hostname}`,
        };
    }
    return { allowed: true };
}

/** boolean だけ欲しい既存呼び出し向けの薄いラッパー。 */
export function isUrlAllowed(url: string, allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS): boolean {
    return checkUrlAllowed(url, allowedDomains).allowed;
}

// ============================================================
// 公開 API
// ============================================================

/**
 * 相対 URL およびプラグインアセット origin への直接フェッチ。
 * allowlist チェックをスキップする (呼び出し側で安全性を保証済みのケース用)。
 */
export async function fetchDirect(url: string, options?: FetchOptions): Promise<FetchResult> {
    return runFetch(url, options);
}

/**
 * プラグイン自身のアセット領域への fetch かを判定し、絶対 URL に解決する。
 *
 * 相対 URL は pluginBase を基準に解決し、**pluginBase 配下 (同一 origin かつパス接頭辞一致)**
 * に収まる場合のみ解決済み URL を返す。ホストの `/api` などプラグイン領域外や、
 * `../` によるディレクトリトラバーサルで抜けた URL、pluginBase 不明の場合は null を返す。
 *
 * これにより「相対 URL でホスト内部 API を credential 付きで叩く」抜け道を塞ぐ。
 * null が返った URL は呼び出し側でドメイン allowlist 検査に回す。
 */
export function resolvePluginAssetUrl(url: string, pluginBase: string | undefined): string | null {
    if (!pluginBase) return null;
    let base: URL;
    try {
        // 末尾スラッシュを付けてディレクトリとして解決させる (最後のセグメントを basename 扱いしない)
        base = new URL(pluginBase.endsWith('/') ? pluginBase : `${pluginBase}/`);
    } catch {
        return null;
    }
    let resolved: URL;
    try {
        resolved = new URL(url, base);
    } catch {
        return null;
    }
    if (resolved.origin !== base.origin) return null;
    if (!resolved.pathname.startsWith(base.pathname)) return null;
    return resolved.href;
}

/**
 * 外部 URL 用フェッチハンドラ。allowlist を満たさない URL は理由コードつきで弾く。
 */
export function createPluginFetchHandler(allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS) {
    return async (url: string, options?: FetchOptions): Promise<FetchResult> => {
        const check = checkUrlAllowed(url, allowedDomains);
        if (!check.allowed) {
            console.warn(`${LOG_PREFIX} ${check.message}`);
            return errorResult(HTTP_STATUS.FORBIDDEN, {
                code: check.code,
                message: check.message,
                ...(check.code === UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED && { allowedDomains }),
            });
        }
        return runFetch(url, options);
    };
}
