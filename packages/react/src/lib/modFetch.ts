/**
 * Worker の NETWORK_FETCH を処理するハンドラ（React 非依存の本体。useModFetch が束ねる）。
 *
 * 1. URL を認可する（自アセット・自名前空間は承認不要、本体の他領域は禁止、外部はドメイン承認）。
 * 2. 外部オリジンには cookie を送らない。
 * 3. リダイレクトは Host の fetch が追わない（送信前に行き先を審査できないため。fetchHandler 参照）。
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
    /** 許可の対象（作者＋mod の ID）。拒否トーストの「許可」が記録する先。 */
    permissionSubject: string;
    appOrigin: string | undefined;
    authorizeUrl: (url: string, signal?: AbortSignal) => Promise<ExternalUrlAccess>;
    fetchImpl?: typeof fetchDirect;
    report?: typeof reportDiagnostic;
}

function credentialsFor(url: string, appOrigin: string | undefined): RequestCredentials {
    return appOrigin !== undefined && new URL(url).origin === appOrigin ? 'same-origin' : 'omit';
}

export function createModFetch({
    modId,
    permissionSubject,
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
            ...(access.domain ? { retry: { subject: permissionSubject, domain: access.domain } } : {}),
        });
        return forbiddenFetchResult(access.code, access.message, responseType);
    };

    return async (url, options, context) => {
        const responseType = options?.responseType;
        const signal = context?.signal;
        const access = await authorizeUrl(url, signal);
        if (signal?.aborted) return abortedFetchResult(signal, responseType);
        if (!access.allowed) return deny(access, responseType);

        return fetchImpl(access.url, options, {
            signal,
            credentials: credentialsFor(access.url, appOrigin),
        });
    };
}
