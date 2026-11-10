/**
 * 受けた要求の署名を確かめる（docs/design/federation.md の受信の手順）。どこかで失敗したら 401（理由はログにだけ残す）。
 *
 * 1. 署名の形・対象・時刻（shared の readSignature）。`@target-uri` は自分のオリジンと受けたパスから組み立てる
 * 2. keyid のホストの方針（block なら 403）
 * 3. Content-Digest と生の本文
 * 4. actor の文書から鍵を取り、shared の verifySignature で確かめる（通らず、文書が 5 分より古ければ 1 度だけ取り直す）
 * 5. nonce の要る RPC は (keyid, nonce) を 6 分覚えて、2 度目を断る
 *
 * inbox だけは Mastodon・Misskey などの draft-cavage（RSA）も受ける（Digest と RSA の鍵で同じ手順を踏む）。
 */
import { createHash } from 'node:crypto';
import {
    actorIdOfKey,
    type DomainPolicy,
    FEDERATION_LIMITS,
    hostOf,
    parseFederationUrl,
    REQUIRED_COMPONENTS,
    type RsaVerifier,
    readCavageSignature,
    readContentDigest,
    readDigestHeader,
    readSignature,
    sameBytes,
    verifyCavageSignature,
    verifySignature,
    type WorldCrypto,
} from '@ubichill/shared';
import type { FederationIdentity } from '../identity';

/** actor の鍵（Ed25519 の Multikey か、ほかの実装の RSA の PEM）。 */
export type VerifiableKey = { id: string; publicKeyMultibase: string } | { id: string; publicKeyPem: string };

export interface VerifiableActor {
    id: string;
    keys: VerifiableKey[];
    fetchedAt: Date;
    deletedAt: Date | null;
}

export interface InboundRequest {
    method: string;
    /** 受けたパスとクエリ（Express の originalUrl） */
    originalUrl: string;
    header(name: string): string | undefined;
    rawBody: Uint8Array | undefined;
}

export type Verified<A> = { ok: true; actor: A; keyId: string; host: string };
export type VerifyFailure = { ok: false; status: 401 | 403; reason: string };

export interface VerifierDeps<A extends VerifiableActor> {
    identity: FederationIdentity;
    allowHttp: boolean;
    policyOf(domain: string): DomainPolicy;
    actors: { get(actorId: string, options?: { refresh?: boolean }): Promise<A | null> };
    seen: { remember(key: string, expiresAt: Date, now: Date): Promise<boolean> };
    /** Ed25519・RSA の照合（照合の手順は shared の verifySignature・verifyCavageSignature） */
    crypto: Pick<WorldCrypto, 'verifyEd25519'> & RsaVerifier;
    /** UNIX ミリ秒 */
    now(): number;
}

const ed25519Keys = (keys: readonly VerifiableKey[]) => keys.flatMap((k) => ('publicKeyMultibase' in k ? [k] : []));
const rsaKeys = (keys: readonly VerifiableKey[]) => keys.flatMap((k) => ('publicKeyPem' in k ? [k] : []));

export function createVerifier<A extends VerifiableActor>(deps: VerifierDeps<A>) {
    const fail = (status: 401 | 403, reason: string): VerifyFailure => ({ ok: false, status, reason });

    /** keyid → 署名した actor（方針・自分のサーバー・消えた actor を断り、通らなければ鍵を 1 度だけ取り直す）。 */
    const signerOf = async (
        keyid: string,
        passes: (actor: A, keyId: string) => Promise<boolean>,
        now: number,
    ): Promise<{ ok: true; actor: A; keyId: string; host: string } | VerifyFailure> => {
        const keyUrl = parseFederationUrl(keyid, { allowHttp: deps.allowHttp });
        const host = keyUrl ? hostOf(keyUrl.href) : null;
        if (!keyUrl || !host) return fail(401, 'keyid');
        if (deps.policyOf(host) === 'block') return fail(403, 'blocked');
        if (host === deps.identity.domain) return fail(401, 'self-signed');

        const actorId = actorIdOfKey(keyUrl.href);
        const cached = await deps.actors.get(actorId);
        if (!cached || cached.deletedAt) return fail(401, 'actor');
        // 通らなければ鍵を取り直す（取り直しすぎない。知らない keyid なら鍵が変わったので早めに）
        const knownKey = cached.keys.some((k) => k.id === keyUrl.href);
        const sinceFetch = now - cached.fetchedAt.getTime();
        const refetch =
            sinceFetch > FEDERATION_LIMITS.KEY_REFETCH_MS ||
            (!knownKey && sinceFetch > FEDERATION_LIMITS.UNKNOWN_KEY_REFETCH_MS);
        // 受けた keyid と同じ鍵で確かめる（keyid は正規形にしたもの）
        const actor = (await passes(cached, keyUrl.href))
            ? cached
            : refetch
              ? await deps.actors.get(actorId, { refresh: true })
              : null;
        if (!actor || actor.deletedAt || !(await passes(actor, keyUrl.href))) return fail(401, 'signature');
        return { ok: true, actor, keyId: keyUrl.href, host };
    };

    const sha256 = (body: Uint8Array | undefined) =>
        createHash('sha256')
            .update(body ?? new Uint8Array())
            .digest();

    /** RFC 9421（ubichill 同士）。 */
    const verifyRfc9421 = async (
        request: InboundRequest,
        method: string,
        now: number,
        options: { requireNonce?: boolean },
    ): Promise<Verified<A> | VerifyFailure> => {
        const message = {
            method,
            targetUri: `${deps.identity.origin}${request.originalUrl}`,
            header: (name: string) => request.header(name),
        };
        const read = readSignature(message, {
            required: method === 'POST' ? REQUIRED_COMPONENTS.post : REQUIRED_COMPONENTS.get,
            now: Math.floor(now / 1000),
            requireNonce: options.requireNonce,
        });
        if (!read.ok) return fail(401, `signature:${read.reason}`);
        const { keyid, signature, base, nonce } = read.value;
        if (method === 'POST') {
            const expected = readContentDigest(request.header('content-digest'));
            if (!expected || !sameBytes(expected, sha256(request.rawBody))) return fail(401, 'digest');
        }
        const signer = await signerOf(
            keyid,
            (actor, keyId) => verifySignature({ keyid: keyId, base, signature }, ed25519Keys(actor.keys), deps.crypto),
            now,
        );
        if (!signer.ok) return signer;
        if (options.requireNonce && nonce) {
            const fresh = await deps.seen.remember(
                `nonce|${signer.keyId}|${nonce}`,
                new Date(now + FEDERATION_LIMITS.NONCE_MS),
                new Date(now),
            );
            if (!fresh) return fail(401, 'replay');
        }
        return signer;
    };

    /** draft-cavage（Mastodon・Misskey など。inbox だけ）。 */
    const verifyCavage = async (
        request: InboundRequest,
        method: string,
        now: number,
    ): Promise<Verified<A> | VerifyFailure> => {
        const read = readCavageSignature(
            {
                method,
                path: request.originalUrl,
                host: deps.identity.domain,
                header: (name: string) => request.header(name),
            },
            { now: Math.floor(now / 1000) },
        );
        if (!read.ok) return fail(401, `cavage:${read.reason}`);
        if (method === 'POST') {
            const expected = readDigestHeader(request.header('digest'));
            if (!expected || !sameBytes(expected, sha256(request.rawBody))) return fail(401, 'digest');
        }
        const { signingString, signature } = read.value;
        return signerOf(
            read.value.keyId,
            (actor, keyId) =>
                verifyCavageSignature({ keyId, signingString, signature }, rsaKeys(actor.keys), deps.crypto),
            now,
        );
    };

    return {
        /**
         * 署名を確かめる。Signature-Input があれば RFC 9421、無くて allowCavage なら draft-cavage
         * （ほかの実装から受けるのは inbox だけ。RPC・部屋の作りは ubichill 同士なので RFC 9421 だけ）。
         */
        async verify(
            request: InboundRequest,
            options: { requireNonce?: boolean; allowCavage?: boolean } = {},
        ): Promise<Verified<A> | VerifyFailure> {
            const method = request.method.toUpperCase();
            const now = deps.now();
            if (request.header('signature-input') || !options.allowCavage || options.requireNonce) {
                return verifyRfc9421(request, method, now, options);
            }
            return verifyCavage(request, method, now);
        },
    };
}
