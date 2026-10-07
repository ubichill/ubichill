/**
 * modの Ubi.fetch を Host 側で実行するハンドラ。
 *
 * 2 系統:
 *  - fetchDirect            : 相対 URL / mod自身の origin 用。allowlist チェックなし。
 *  - createModFetchHandler: 外部 URL 用。allowlist (https + ドメイン) でガードする。
 *
 * Host が合成した失敗（ドメイン拒否 / HTTPS必須 / 制限時間 / サイズ超過 / …）は `res.error.code` で判別できる。
 * text の本文は従来どおり `{ error }` の JSON 文字列も入れる。
 */
import { type FetchOptions, type FetchResult, normalizeFetchLimits, UbiErrorCode } from '@ubichill/shared';

const LOG_PREFIX = '[FetchHandler]';

/** HTTP ステータス (Host が合成して返すもの)。 */
const HTTP_STATUS = {
    FORBIDDEN: { status: 403, statusText: 'Forbidden' },
    PAYLOAD_TOO_LARGE: { status: 413, statusText: 'Payload Too Large' },
    INTERNAL_ERROR: { status: 500, statusText: 'Internal Server Error' },
    GATEWAY_TIMEOUT: { status: 504, statusText: 'Gateway Timeout' },
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

/** mod から見えない Host 側の通信条件。 */
export interface HostFetchContext {
    /** 取り消し（mod の CMD_ABORT・制限時間・Worker 破棄）。 */
    signal?: AbortSignal;
    /** 外部オリジンには cookie を送らないため 'omit' を渡す。 */
    credentials?: RequestCredentials;
}

// ============================================================
// allowlist ポリシー
//   NOTE: 本来これはアプリ固有のポリシーであり、consumer が
//   createModFetchHandler(domains) に注入するのが理想。
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
// 制限と本文の読み込み
// ============================================================

/** 本文を maxBytes まで読む。超えたら読み込みを止めて 'too-large' を返す（全体をメモリに載せない）。 */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<ArrayBuffer | 'too-large'> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        return 'too-large';
    }
    if (!response.body) return new ArrayBuffer(0);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const read = async (total: number): Promise<number | 'too-large'> => {
        const { done, value } = await reader.read();
        if (done) return total;
        const next = total + value.byteLength;
        if (next > maxBytes) {
            await reader.cancel();
            return 'too-large';
        }
        chunks.push(value);
        return read(next);
    };
    const total = await read(0);
    if (total === 'too-large') return 'too-large';

    const bytes = new Uint8Array(total);
    chunks.reduce((offset, chunk) => {
        bytes.set(chunk, offset);
        return offset + chunk.byteLength;
    }, 0);
    return bytes.buffer;
}

// ============================================================
// 内部ヘルパー (重複排除)
// ============================================================

/** Host が合成するエラー FetchResult を作る。本文は responseType に合わせる（text は従来どおり JSON）。 */
function errorResult(
    http: { status: number; statusText: string },
    error: FetchErrorBody['error'],
    responseType: FetchOptions['responseType'] = 'text',
): FetchResult<string | ArrayBuffer> {
    return {
        ok: false,
        status: http.status,
        statusText: http.statusText,
        headers: {},
        error: { code: error.code, message: error.message },
        body: responseType === 'arrayBuffer' ? new ArrayBuffer(0) : JSON.stringify({ error } satisfies FetchErrorBody),
    };
}

function headersOf(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    return headers;
}

function abortedResult(signal: AbortSignal, responseType: FetchOptions['responseType']) {
    const reason = signal.reason as { name?: string } | undefined;
    return reason?.name === 'TimeoutError'
        ? errorResult(
              HTTP_STATUS.GATEWAY_TIMEOUT,
              { code: UbiErrorCode.FETCH_TIMEOUT, message: '制限時間内に通信が終わりませんでした' },
              responseType,
          )
        : errorResult(
              HTTP_STATUS.INTERNAL_ERROR,
              { code: UbiErrorCode.FETCH_ABORTED, message: '通信は取り消されました' },
              responseType,
          );
}

/** 実際の fetch 実行 + 例外・制限超過を FetchResult に正規化する。 */
async function runFetch(
    url: string,
    options: FetchOptions | undefined,
    context: HostFetchContext,
): Promise<FetchResult<string | ArrayBuffer>> {
    const responseType = options?.responseType ?? 'text';
    const { timeoutMs, maxBytes } = normalizeFetchLimits(options);
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(context.signal ? [context.signal] : [])]);
    if (signal.aborted) return abortedResult(signal, responseType);

    try {
        const response = await fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body as BodyInit | undefined,
            credentials: context.credentials,
            signal,
        });
        const bytes = await readBodyWithLimit(response, maxBytes);
        if (bytes === 'too-large') {
            return errorResult(
                HTTP_STATUS.PAYLOAD_TOO_LARGE,
                {
                    code: UbiErrorCode.FETCH_RESPONSE_TOO_LARGE,
                    message: `本文が上限 (${maxBytes} byte) を超えました`,
                },
                responseType,
            );
        }
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: headersOf(response),
            url: response.url || url,
            body: responseType === 'arrayBuffer' ? bytes : new TextDecoder().decode(bytes),
        };
    } catch (error) {
        if (signal.aborted) return abortedResult(signal, responseType);
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`${LOG_PREFIX} フェッチ失敗: ${url}`, error);
        return errorResult(
            HTTP_STATUS.INTERNAL_ERROR,
            { code: UbiErrorCode.FETCH_NETWORK_ERROR, message },
            responseType,
        );
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
 * 認可済み URL への直接フェッチ。allowlist チェックをスキップする（呼び出し側で認可済みのケース用）。
 */
export async function fetchDirect(
    url: string,
    options?: FetchOptions,
    context: HostFetchContext = {},
): Promise<FetchResult<string | ArrayBuffer>> {
    return runFetch(url, options, context);
}

/**
 * mod自身のアセット領域への fetch かを判定し、絶対 URL に解決する。
 *
 * 相対 URL は modBase を基準に解決し、**modBase 配下 (同一 origin かつパス接頭辞一致)**
 * に収まる場合のみ解決済み URL を返す。ホストの `/api` などmod領域外や、
 * `../` によるディレクトリトラバーサルで抜けた URL、modBase 不明の場合は null を返す。
 *
 * これにより「相対 URL でホスト内部 API を credential 付きで叩く」抜け道を塞ぐ。
 * null が返った URL は呼び出し側でドメイン allowlist 検査に回す。
 */
export function resolveModAssetUrl(url: string, modBase: string | undefined): string | null {
    if (!modBase) return null;
    let base: URL;
    try {
        // 末尾スラッシュを付けてディレクトリとして解決させる (最後のセグメントを basename 扱いしない)
        base = new URL(modBase.endsWith('/') ? modBase : `${modBase}/`);
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
 * mod自身の「公開名前空間」への fetch かを判定し、絶対 URL に解決する。
 *
 * modはアプリ本体に載って **`/mods/<modId>/…`** で公開される（assets も、
 * 専用バックエンド例: `/mods/video-player/api` も）。ここはmod自身の領域なので
 * 承認不要で通す。全mod共通の配信規約なので普遍的（特定modの特例ではない）。
 *
 * - `appOrigin` はアプリ本体のオリジン（例: `window.location.origin`）。
 * - コアの `/api/v1/…`・他modの名前空間・別オリジン・`../` 脱出は null
 *   （＝ここでは通さない）。本体コア API を叩く抜け道は塞いだまま。
 */
export function resolveModNamespaceUrl(
    url: string,
    modId: string | undefined,
    appOrigin: string | undefined,
): string | null {
    if (!modId || !appOrigin) return null;
    let resolved: URL;
    try {
        resolved = new URL(url, appOrigin);
    } catch {
        return null;
    }
    if (resolved.origin !== appOrigin) return null;
    if (!resolved.pathname.startsWith(`/mods/${modId}/`)) return null;
    return resolved.href;
}

/**
 * 外部 URL 用フェッチハンドラ。allowlist を満たさない URL は理由コードつきで弾く。
 */
export function createModFetchHandler(allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS) {
    return async (
        url: string,
        options?: FetchOptions,
        context: HostFetchContext = {},
    ): Promise<FetchResult<string | ArrayBuffer>> => {
        const check = checkUrlAllowed(url, allowedDomains);
        if (!check.allowed) {
            console.warn(`${LOG_PREFIX} ${check.message}`);
            return errorResult(
                HTTP_STATUS.FORBIDDEN,
                {
                    code: check.code,
                    message: check.message,
                    ...(check.code === UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED && { allowedDomains }),
                },
                options?.responseType,
            );
        }
        return runFetch(url, options, { credentials: 'omit', ...context });
    };
}

/** 認可で拒否したときの FetchResult（本文は responseType に合わせる）。 */
export function forbiddenFetchResult(
    code: UbiErrorCode,
    message: string,
    responseType?: FetchOptions['responseType'],
): FetchResult<string | ArrayBuffer> {
    return errorResult(HTTP_STATUS.FORBIDDEN, { code, message }, responseType);
}

/** 制限時間・取り消しで打ち切ったときの FetchResult。 */
export function abortedFetchResult(
    signal: AbortSignal,
    responseType?: FetchOptions['responseType'],
): FetchResult<string | ArrayBuffer> {
    return abortedResult(signal, responseType);
}
