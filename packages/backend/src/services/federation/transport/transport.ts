/**
 * ほかのサーバーへの署名付きの要求（送るたびに署名し直す）。取得はすべて safeFetch（SSRF 対策）を通す。
 *
 * 署名の方式は 2 つ:
 * - rfc9421: ubichill 同士（Ed25519）。RPC と、RFC 9421 の Ed25519 を告知しているサーバー
 * - cavage: Mastodon・Misskey など（RSA の draft-cavage）。`scheme: 'auto'` で、相手が rfc9421 を告知していなければこちら
 */
import { createHash, randomBytes } from 'node:crypto';
import {
    AP_ACCEPT,
    CAVAGE_SIGNED_HEADERS,
    contentDigest,
    digestHeader,
    REQUIRED_COMPONENTS,
    SIGNATURE_ALGORITHM,
    signCavage,
    signMessage,
} from '@ubichill/shared';
import type { FederationIdentity } from '../identity';
import type { Keyring } from './keys';
import type { RsaKeyring } from './rsaKeys';

/** どの actor の鍵で署名するか。サーバーの判断は Application actor、ユーザーの操作はそのユーザー。 */
export type SignAs = { kind: 'app' } | { kind: 'user'; userId: string };

/** 署名の方式。auto は相手のサーバーで決める（ubichill の RPC は rfc9421 のまま） */
export type SignatureScheme = 'rfc9421' | 'cavage';

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
    get(
        url: string,
        options: { signAs: SignAs; maxBytes: number; accept?: string; scheme?: SignatureScheme | 'auto' },
    ): Promise<FederationResponse>;
    post(
        url: string,
        body: unknown,
        options: {
            signAs: SignAs;
            ttlSec: number;
            contentType: string;
            nonce?: boolean;
            maxBytes?: number;
            scheme?: SignatureScheme | 'auto';
        },
    ): Promise<FederationResponse>;
}

export function createTransport(deps: {
    identity: FederationIdentity;
    keyring: Keyring;
    rsaKeys: RsaKeyring;
    fetch: FetchLike;
    /** UNIX ミリ秒 */
    now: () => number;
    /** auto のとき、そのホストへの署名の方式 */
    schemeFor(host: string): Promise<SignatureScheme>;
}): Transport {
    const actorOf = (signAs: SignAs) =>
        signAs.kind === 'app' ? deps.identity.appActorUrl : deps.identity.actorUrl(signAs.userId);

    /** RFC 9421（Ed25519）の Signature-Input・Signature。 */
    const rfc9421 = async (
        target: URL,
        method: 'GET' | 'POST',
        headers: Record<string, string>,
        options: { signAs: SignAs; ttlSec: number; nonce?: boolean },
    ): Promise<Record<string, string>> => {
        const signer = deps.keyring.signerFor(actorOf(options.signAs));
        const created = Math.floor(deps.now() / 1000);
        return signMessage(
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
    };

    /** draft-cavage（RSA）の Date・Digest・Signature。Host は fetch が URL から付ける（署名と同じ値）。 */
    const cavage = async (
        target: URL,
        method: 'GET' | 'POST',
        headers: Record<string, string>,
        options: { signAs: SignAs },
        body?: string,
    ): Promise<Record<string, string>> => {
        const actor = actorOf(options.signAs);
        const signer = await deps.rsaKeys.signerFor(
            actor,
            options.signAs.kind === 'user' ? options.signAs.userId : null,
        );
        const extra: Record<string, string> = {
            date: new Date(deps.now()).toUTCString(),
            ...(body !== undefined ? { digest: digestHeader(createHash('sha256').update(body).digest()) } : {}),
        };
        const all = { ...headers, ...extra };
        const signature = await signCavage(
            { method, path: `${target.pathname}${target.search}`, host: target.host, header: (name) => all[name] },
            method === 'POST' ? CAVAGE_SIGNED_HEADERS.post : CAVAGE_SIGNED_HEADERS.get,
            signer.keyId,
            (data) => signer.sign(data),
        );
        return { ...extra, signature };
    };

    const send = async (
        url: string,
        method: 'GET' | 'POST',
        headers: Record<string, string>,
        options: {
            signAs: SignAs;
            ttlSec: number;
            nonce?: boolean;
            maxBytes: number;
            scheme?: SignatureScheme | 'auto';
        },
        body?: string,
    ): Promise<FederationResponse> => {
        const target = new URL(url);
        // nonce は RFC 9421 にしか無い（入室など、権利を返す RPC は ubichill 同士）
        const scheme =
            options.nonce || (options.scheme ?? 'rfc9421') === 'rfc9421'
                ? 'rfc9421'
                : options.scheme === 'auto'
                  ? await deps.schemeFor(target.host.toLowerCase())
                  : 'cavage';
        const signed =
            scheme === 'rfc9421'
                ? await rfc9421(target, method, headers, options)
                : await cavage(target, method, headers, options, body);
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
