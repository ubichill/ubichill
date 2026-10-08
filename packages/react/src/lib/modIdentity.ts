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

export function createModIdentity({
    modId,
    authorizeUrl,
    requestToken,
    now = Date.now,
    report = reportDiagnostic,
}: ModIdentityDeps): ModIdentityHandler {
    const cache = new Map<string, RpcIdentityTokenResult>();
    const inFlight = new Map<string, Promise<RpcIdentityTokenResult>>();

    const issue = (request: RequestServiceToken, audience: string): Promise<RpcIdentityTokenResult> => {
        const pending = inFlight.get(audience);
        if (pending) return pending;
        // 共有する依頼は、最初の依頼者が取り消しても他の依頼者のために続ける（signal を渡さない）。
        const created = request({ audience, modId })
            .then((result) => {
                cache.set(audience, result);
                return result;
            })
            .finally(() => inFlight.delete(audience));
        inFlight.set(audience, created);
        return created;
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
        return issue(requestToken, audience);
    };
}
