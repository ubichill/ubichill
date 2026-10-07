/**
 * Worker の NETWORK_FETCH を処理するハンドラ（React 非依存の本体。useModFetch が束ねる）。
 *
 * 1. URL を認可する（自アセット・自名前空間は承認不要、本体の他領域は禁止、外部はドメイン承認）。
 * 2. 外部オリジンには cookie を送らない（リダイレクトで本体へ戻されても認証付きで届かないように）。
 * 3. リダイレクトで URL が変わったら、行き先も同じ規則で認可し直す。通らなければ本文を捨てる。
 */
import {
    abortedFetchResult,
    fetchDirect,
    forbiddenFetchResult,
    type HostFetchContext,
    reportDiagnostic,
} from '@ubichill/sandbox';
import type { FetchOptions, FetchResult, UbiErrorCode } from '@ubichill/shared';
import type { ExternalUrlAccess } from './externalUrlAuthorization';

export type ModFetchHandler = (
    url: string,
    options?: FetchOptions,
    context?: HostFetchContext,
) => Promise<FetchResult<string | ArrayBuffer>>;

export interface ModFetchDeps {
    modId: string;
    appOrigin: string | undefined;
    authorizeUrl: (url: string) => Promise<ExternalUrlAccess>;
    fetchImpl?: typeof fetchDirect;
    report?: typeof reportDiagnostic;
}

function credentialsFor(url: string, appOrigin: string | undefined): RequestCredentials {
    return appOrigin !== undefined && new URL(url).origin === appOrigin ? 'same-origin' : 'omit';
}

export function createModFetch({
    modId,
    appOrigin,
    authorizeUrl,
    fetchImpl = fetchDirect,
    report = reportDiagnostic,
}: ModFetchDeps): ModFetchHandler {
    // 拒否は必ず診断に出す。domain を渡すと拒否トーストに「許可」ボタンが付く。
    const deny = (
        access: { code: UbiErrorCode; message: string; domain?: string },
        responseType: FetchOptions['responseType'],
    ): FetchResult<string | ArrayBuffer> => {
        report({
            level: 'warn',
            modId,
            code: access.code,
            message: access.message,
            ...(access.domain ? { retry: { modId, domain: access.domain } } : {}),
        });
        return forbiddenFetchResult(access.code, access.message, responseType);
    };

    return async (url, options, context) => {
        const responseType = options?.responseType;
        const access = await authorizeUrl(url);
        if (!access.allowed) return deny(access, responseType);
        if (context?.signal?.aborted) return abortedFetchResult(context.signal, responseType);

        const result = await fetchImpl(access.url, options, {
            signal: context?.signal,
            credentials: credentialsFor(access.url, appOrigin),
        });
        if (!result.url || result.url === access.url) return result;

        const redirected = await authorizeUrl(result.url);
        if (redirected.allowed) return result;
        return deny(
            { ...redirected, message: `リダイレクト先が許可されていません: ${redirected.message}` },
            responseType,
        );
    };
}
