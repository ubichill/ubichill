/**
 * ほかのサーバーへの署名付きの要求（RFC 9421。送るたびに署名し直す）。取得はすべて safeFetch（SSRF 対策）を通す。
 */
import { createHash, randomBytes } from 'node:crypto';
import { AP_ACCEPT, contentDigest, REQUIRED_COMPONENTS, SIGNATURE_ALGORITHM, signMessage } from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Keyring } from './keys';

/** どの actor の鍵で署名するか。サーバーの判断は Application actor、ユーザーの操作はそのユーザー。 */
export type SignAs = { kind: 'app' } | { kind: 'user'; userId: string };

export interface FederationResponse {
    status: number;
    contentType: string | undefined;
    /** JSON として読めた本文（読めなければ undefined） */
    json: unknown;
    retryAfter: string | null;
}

export type FetchLike = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; maxBytes?: number; maxRedirects?: number },
) => Promise<Response>;

export interface Transport {
    get(url: string, options: { signAs: SignAs; maxBytes: number; accept?: string }): Promise<FederationResponse>;
    post(
        url: string,
        body: unknown,
        options: { signAs: SignAs; ttlSec: number; contentType: string; nonce?: boolean; maxBytes?: number },
    ): Promise<FederationResponse>;
}

export function createTransport(deps: {
    identity: FederationIdentity;
    keyring: Keyring;
    fetch: FetchLike;
    /** UNIX ミリ秒 */
    now: () => number;
}): Transport {
    const signerOf = (signAs: SignAs) =>
        deps.keyring.signerFor(
            signAs.kind === 'app' ? deps.identity.appActorUrl : deps.identity.actorUrl(signAs.userId),
        );

    const send = async (
        url: string,
        method: 'GET' | 'POST',
        headers: Record<string, string>,
        options: { signAs: SignAs; ttlSec: number; nonce?: boolean; maxBytes: number },
        body?: string,
    ): Promise<FederationResponse> => {
        const target = new URL(url);
        const signer = signerOf(options.signAs);
        const created = Math.floor(deps.now() / 1000);
        const signed = await signMessage(
            { method, targetUri: target.href, header: (name) => headers[name] },
            method === 'POST' ? REQUIRED_COMPONENTS.post : REQUIRED_COMPONENTS.get,
            {
                created,
                expires: created + options.ttlSec,
                ...(options.nonce ? { nonce: randomBytes(16).toString('base64url') } : {}),
                keyid: signer.keyId,
                alg: SIGNATURE_ALGORITHM,
            },
            (data) => signer.sign(data),
        );
        // 宛先のオリジンは変わらない（リダイレクトで別の相手へ署名を持ち出させない）
        const response = await deps.fetch(target.href, {
            method,
            headers: { ...headers, ...signed },
            ...(body !== undefined ? { body } : {}),
            maxBytes: options.maxBytes,
            maxRedirects: 0,
        });
        const text = await response.text().catch(() => '');
        const json = (() => {
            try {
                return text ? (JSON.parse(text) as unknown) : undefined;
            } catch {
                return undefined;
            }
        })();
        return {
            status: response.status,
            contentType: response.headers.get('content-type') ?? undefined,
            json,
            retryAfter: response.headers.get('retry-after'),
        };
    };

    return {
        get(url, options) {
            return send(url, 'GET', { accept: options.accept ?? AP_ACCEPT }, { ...options, ttlSec: 60 });
        },
        post(url, body, options) {
            const text = JSON.stringify(body);
            const headers = {
                'content-type': options.contentType,
                'content-digest': contentDigest(createHash('sha256').update(text).digest()),
                accept: 'application/json, application/activity+json',
            };
            return send(url, 'POST', headers, { ...options, maxBytes: options.maxBytes ?? 256 * 1024 }, text);
        },
    };
}
