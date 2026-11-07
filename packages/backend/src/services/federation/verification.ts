/**
 * 受けた要求の署名を確かめる（docs/design/federation.md の受信の手順）。どこかで失敗したら 401（理由はログにだけ残す）。
 *
 * 1. 署名の形・対象・時刻（shared の readSignature）。`@target-uri` は自分のオリジンと受けたパスから組み立てる
 * 2. keyid のホストの方針（block なら 403）
 * 3. Content-Digest と生の本文
 * 4. actor の文書から鍵を取り、shared の verifySignature で確かめる（通らず、文書が 5 分より古ければ 1 度だけ取り直す）
 * 5. nonce の要る RPC は (keyid, nonce) を 6 分覚えて、2 度目を断る
 */
import { createHash } from 'node:crypto';
import {
    actorIdOfKey,
    type DomainPolicy,
    FEDERATION_LIMITS,
    hostOf,
    parseFederationUrl,
    REQUIRED_COMPONENTS,
    readContentDigest,
    readSignature,
    sameBytes,
    verifySignature,
    type WorldCrypto,
} from '@ubichill/shared';
import type { FederationIdentity } from './identity';

export interface VerifiableActor {
    id: string;
    keys: Array<{ id: string; publicKeyMultibase: string }>;
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
    /** Ed25519 の照合（照合の手順は shared の verifySignature） */
    crypto: Pick<WorldCrypto, 'verifyEd25519'>;
    /** UNIX ミリ秒 */
    now(): number;
}

export function createVerifier<A extends VerifiableActor>(deps: VerifierDeps<A>) {
    const fail = (status: 401 | 403, reason: string): VerifyFailure => ({ ok: false, status, reason });

    return {
        async verify(
            request: InboundRequest,
            options: { requireNonce?: boolean } = {},
        ): Promise<Verified<A> | VerifyFailure> {
            const method = request.method.toUpperCase();
            const now = deps.now();
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

            const keyUrl = parseFederationUrl(keyid, { allowHttp: deps.allowHttp });
            const host = keyUrl ? hostOf(keyUrl.href) : null;
            if (!keyUrl || !host) return fail(401, 'keyid');
            if (deps.policyOf(host) === 'block') return fail(403, 'blocked');
            if (host === deps.identity.domain) return fail(401, 'self-signed');

            if (method === 'POST') {
                const expected = readContentDigest(request.header('content-digest'));
                const actual = createHash('sha256')
                    .update(request.rawBody ?? new Uint8Array())
                    .digest();
                if (!expected || !sameBytes(expected, actual)) return fail(401, 'digest');
            }

            const actorId = actorIdOfKey(keyUrl.href);
            const cached = await deps.actors.get(actorId);
            if (!cached || cached.deletedAt) return fail(401, 'actor');
            // 受けた keyid と同じ鍵で確かめる（keyid は正規形にしたもの）
            const signed = { keyid: keyUrl.href, base, signature };
            const passes = (actor: A) => verifySignature(signed, actor.keys, deps.crypto);
            const actor = (await passes(cached))
                ? cached
                : now - cached.fetchedAt.getTime() > FEDERATION_LIMITS.KEY_REFETCH_MS
                  ? await deps.actors.get(actorId, { refresh: true })
                  : null;
            if (!actor || actor.deletedAt || !(await passes(actor))) return fail(401, 'signature');

            if (options.requireNonce && nonce) {
                const fresh = await deps.seen.remember(
                    `nonce|${keyUrl.href}|${nonce}`,
                    new Date(now + FEDERATION_LIMITS.NONCE_MS),
                    new Date(now),
                );
                if (!fresh) return fail(401, 'replay');
            }
            return { ok: true, actor, keyId: keyUrl.href, host };
        },
    };
}
