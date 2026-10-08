/**
 * Worker の IDENTITY_TOKEN を処理する（React 非依存の本体。useModIdentity が束ねる）。
 *
 * 1. 宛先をサービスのオリジンに正規化する。
 * 2. 宛先は fetch と同じ規則で認可する（ユーザーが通信を許したドメインにしか証明を渡さない）。
 * 3. 同じ宛先のトークンは期限の少し前まで使い回し、同時の依頼は 1 つにまとめる。
 */
import { reportDiagnostic } from '@ubichill/sandbox';
import { normalizeServiceAudience, type RpcIdentityTokenResult, UbiError, UbiErrorCode } from '@ubichill/shared';
import type { RequestServiceToken } from '../components/ServiceTokenContext';
import type { ExternalUrlAccess } from './externalUrlAuthorization';

/** 期限までこれ未満しか残っていないトークンは使い回さない（サービスに届く前に切れないように）。 */
export const IDENTITY_TOKEN_REUSE_MARGIN_MS = 60_000;

export type ModIdentityHandler = (
    audience: string,
    context: { signal: AbortSignal },
) => Promise<RpcIdentityTokenResult>;

export interface ModIdentityDeps {
    modId: string;
    authorizeUrl: (url: string, signal?: AbortSignal) => Promise<ExternalUrlAccess>;
    requestToken: RequestServiceToken | null;
    now?: () => number;
    report?: typeof reportDiagnostic;
}

interface PendingToken {
    controller: AbortController;
    promise: Promise<RpcIdentityTokenResult>;
    state: { waiters: number; settled: boolean };
}

function cancelledToken(signal: AbortSignal): UbiError {
    return new UbiError(
        signal.reason?.name === 'TimeoutError' ? UbiErrorCode.FETCH_TIMEOUT : UbiErrorCode.FETCH_ABORTED,
        '身元証明の依頼は取り消されました',
    );
}

export function createModIdentity({
    modId,
    authorizeUrl,
    requestToken,
    now = Date.now,
    report = reportDiagnostic,
}: ModIdentityDeps): ModIdentityHandler {
    const cache = new Map<string, RpcIdentityTokenResult>();
    const inFlight = new Map<string, PendingToken>();

    const start = (request: RequestServiceToken, audience: string): PendingToken => {
        const pending = inFlight.get(audience);
        if (pending) return pending;
        const controller = new AbortController();
        const state = { waiters: 0, settled: false };
        const promise = Promise.resolve()
            .then(() => request({ audience, modId, signal: controller.signal }))
            .then((result) => {
                if (controller.signal.aborted) throw cancelledToken(controller.signal);
                cache.set(audience, result);
                return result;
            })
            .finally(() => {
                state.settled = true;
                if (inFlight.get(audience)?.promise === promise) inFlight.delete(audience);
            });
        const created = { controller, state, promise };
        inFlight.set(audience, created);
        return created;
    };

    const issue = async (request: RequestServiceToken, audience: string, signal: AbortSignal) => {
        const pending = start(request, audience);
        pending.state.waiters += 1;
        const aborted = Promise.withResolvers<never>();
        const cancel = () => aborted.reject(cancelledToken(signal));
        signal.addEventListener('abort', cancel, { once: true });
        try {
            return await Promise.race([pending.promise, aborted.promise]);
        } finally {
            signal.removeEventListener('abort', cancel);
            pending.state.waiters -= 1;
            // 他の依頼者が待っている間は共有する。Worker 破棄・制限時間などで全員が外れたら通信も止める。
            if (pending.state.waiters === 0 && !pending.state.settled) {
                if (inFlight.get(audience) === pending) inFlight.delete(audience);
                pending.controller.abort(signal.reason);
            }
        }
    };

    return async (rawAudience, { signal }) => {
        const audience = normalizeServiceAudience(rawAudience);
        if (!audience) {
            throw new UbiError(
                UbiErrorCode.IDENTITY_AUDIENCE_INVALID,
                `宛先はサービスのオリジン（https://example.com）で指定してください: ${rawAudience}`,
            );
        }
        if (!requestToken) {
            throw new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, 'この画面では身元証明を発行できません');
        }

        const access = await authorizeUrl(`${audience}/`, signal);
        if (signal.aborted) throw new UbiError(UbiErrorCode.FETCH_ABORTED, '取り消されました');
        if (!access.allowed) {
            report({
                level: 'warn',
                modId,
                code: access.code,
                message: access.message,
                ...(access.domain ? { retry: { modId, domain: access.domain } } : {}),
            });
            throw new UbiError(access.code, access.message);
        }

        const cached = cache.get(audience);
        if (cached && cached.expiresAt - now() > IDENTITY_TOKEN_REUSE_MARGIN_MS) return cached;
        return issue(requestToken, audience, signal);
    };
}
