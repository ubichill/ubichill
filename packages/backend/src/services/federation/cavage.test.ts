/**
 * Mastodon・Misskey など、ほかの実装との署名（draft-cavage・RSA）を、送る側（transport）から受ける側（verifier）まで通す。
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { ActorKeyRecord } from '@ubichill/db';
import { digestHeader } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { createFederationIdentity } from './identity';
import { createKeyring } from './keys';
import { createRsaKeyring, verifyRsaSha256 } from './rsaKeys';
import { createTransport, type SignatureScheme } from './transport';
import { createVerifier, type InboundRequest, type VerifiableActor } from './verification';

const A = createFederationIdentity('https://a.example');
const B = createFederationIdentity('https://b.example');
const ALICE = A.actorUrl('alice');
const T0 = Date.parse('2026-11-09T00:00:00Z');

const pair = (() => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKeyDer: privateKey.export({ type: 'pkcs8', format: 'der' }),
        privateKey,
    };
})();

const rows = new Map<string, ActorKeyRecord>();
const rsaKeys = createRsaKeyring({
    seed: randomBytes(32),
    repo: {
        get: async (id) => rows.get(id),
        insertIfAbsent: async (key, now) => {
            if (!rows.has(key.actorId)) rows.set(key.actorId, { ...key, createdAt: now });
            return rows.get(key.actorId) as ActorKeyRecord;
        },
        rewrap: async () => undefined,
        replace: async () => {
            throw new Error('使わない');
        },
    },
    generate: async () => pair,
    now: () => T0,
});
const keyring = createKeyring({ seed: randomBytes(32) });

interface Sent {
    url: string;
    headers: Record<string, string>;
    body?: string;
}

/** A が B へ送った要求（scheme は相手のサーバーの告知で決まる）。 */
async function send(
    options: { scheme: SignatureScheme; method?: 'GET' | 'POST'; nonce?: boolean; at?: number; path?: string } = {
        scheme: 'cavage',
    },
): Promise<Sent> {
    const captured: Sent[] = [];
    const transport = createTransport({
        identity: A,
        keyring,
        rsaKeys,
        schemeFor: async () => options.scheme,
        now: () => options.at ?? T0,
        fetch: async (url, init) => {
            captured.push({ url, headers: init.headers, body: init.body });
            return new Response('', { status: 202 });
        },
    });
    const url = `${B.origin}${options.path ?? '/ap/inbox'}`;
    if (options.method === 'GET') {
        await transport.get(url, { signAs: { kind: 'app' }, maxBytes: 1024, scheme: 'auto' });
    } else {
        await transport.post(
            url,
            { type: 'Follow' },
            {
                signAs: { kind: 'user', userId: 'alice' },
                ttlSec: 60,
                contentType: 'application/activity+json',
                scheme: 'auto',
                nonce: options.nonce,
            },
        );
    }
    const sent = captured[0];
    if (!sent) throw new Error('送っていない');
    return sent;
}

/** B が受けた形（Host は B 自身。path を差し替えると別の宛先に送り直したことになる）。 */
const received = (sent: Sent, change: { path?: string; body?: string; method?: string } = {}): InboundRequest => {
    const url = new URL(sent.url);
    const headers = Object.fromEntries(Object.entries(sent.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method: change.method ?? (sent.body === undefined ? 'GET' : 'POST'),
        originalUrl: change.path ?? url.pathname + url.search,
        header: (name) => headers[name.toLowerCase()],
        rawBody: new TextEncoder().encode(change.body ?? sent.body ?? ''),
    };
};

/** B: A の actor（alice と Application actor）の文書を知っている。 */
async function verifierAt(now: number) {
    const actorOf = async (id: string): Promise<VerifiableActor> => {
        const rsa = await rsaKeys.signerFor(id, id === ALICE ? 'alice' : null);
        const ed = keyring.signerFor(id);
        return {
            id,
            keys: [
                { id: ed.keyId, publicKeyMultibase: ed.publicKeyMultibase },
                { id: rsa.keyId, publicKeyPem: rsa.publicKeyPem },
            ],
            fetchedAt: new Date(now),
            deletedAt: null,
        };
    };
    return createVerifier<VerifiableActor>({
        identity: B,
        allowHttp: false,
        policyOf: () => 'allow',
        actors: { get: async (id) => (id === ALICE || id === A.appActorUrl ? actorOf(id) : null) },
        seen: { remember: async () => true },
        crypto: { verifyEd25519: nodeWorldCrypto.verifyEd25519, verifyRsaSha256 },
        now: () => now,
    });
}

describe('ほかの実装との署名（draft-cavage・RSA）', () => {
    it('RFC 9421 を告知していない相手へは、Date・Digest・Signature（keyId は #main-key）を付けて送る', async () => {
        const sent = await send();
        expect(sent.headers.signature).toMatch(
            /^keyId="https:\/\/a\.example\/ap\/users\/alice#main-key",algorithm="rsa-sha256",headers="\(request-target\) host date digest content-type",signature="[A-Za-z0-9+/=]+"$/,
        );
        expect(sent.headers.digest).toBe(
            digestHeader(
                createHash('sha256')
                    .update(sent.body ?? '')
                    .digest(),
            ),
        );
        expect(sent.headers.date).toBe(new Date(T0).toUTCString());
        expect(sent.headers['signature-input']).toBeUndefined();
    });

    it('inbox では受け、署名した actor を返す', async () => {
        const verifier = await verifierAt(T0);
        expect(await verifier.verify(received(await send()), { allowCavage: true })).toMatchObject({
            ok: true,
            actor: { id: ALICE },
        });
    });

    it('RPC・部屋の作り（allowCavage なし）と、nonce の要る要求では受けない', async () => {
        const verifier = await verifierAt(T0);
        const sent = received(await send());
        expect(await verifier.verify(sent)).toMatchObject({ ok: false, status: 401 });
        expect(await verifier.verify(sent, { allowCavage: true, requireNonce: true })).toMatchObject({ ok: false });
    });

    it('本文を書き換えると Digest で、別の宛先へ送り直すと署名で断る', async () => {
        const verifier = await verifierAt(T0);
        const sent = await send();
        expect(await verifier.verify(received(sent, { body: '{"type":"Undo"}' }), { allowCavage: true })).toEqual({
            ok: false,
            status: 401,
            reason: 'digest',
        });
        expect(await verifier.verify(received(sent, { path: '/ap/users/bob/inbox' }), { allowCavage: true })).toEqual({
            ok: false,
            status: 401,
            reason: 'signature',
        });
    });

    it('1 時間より前の Date・5 分より先の Date は断る（相手の送り直しの遅れと時計のずれは受ける）', async () => {
        const verifier = await verifierAt(T0);
        const late = await send({ scheme: 'cavage', at: T0 - 50 * 60 * 1000 });
        expect(await verifier.verify(received(late), { allowCavage: true })).toMatchObject({ ok: true });
        const old = await send({ scheme: 'cavage', at: T0 - 61 * 60 * 1000 });
        expect(await verifier.verify(received(old), { allowCavage: true })).toMatchObject({ reason: 'cavage:expired' });
        const future = await send({ scheme: 'cavage', at: T0 + 6 * 60 * 1000 });
        expect(await verifier.verify(received(future), { allowCavage: true })).toMatchObject({
            reason: 'cavage:future',
        });
    });

    it('Digest を署名していない POST・ほかの人の鍵の署名は断る', async () => {
        const verifier = await verifierAt(T0);
        const sent = await send();
        const withoutDigest = {
            ...sent,
            headers: {
                ...sent.headers,
                signature: sent.headers.signature?.replace('date digest content-type', 'date content-type') ?? '',
            },
        };
        expect(await verifier.verify(received(withoutDigest), { allowCavage: true })).toMatchObject({
            reason: 'cavage:components',
        });
        // 同じ文字列を別の鍵で署名して、alice の keyId を名乗る
        const forged = sign(
            'sha256',
            Buffer.from(
                `(request-target): post /ap/inbox\nhost: b.example\ndate: ${sent.headers.date}\ndigest: ${sent.headers.digest}\ncontent-type: application/activity+json`,
            ),
            generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
        ).toString('base64');
        const impostor = {
            ...sent,
            headers: {
                ...sent.headers,
                signature: sent.headers.signature?.replace(/signature="[^"]+"/, `signature="${forged}"`) ?? '',
            },
        };
        expect(await verifier.verify(received(impostor), { allowCavage: true })).toMatchObject({ reason: 'signature' });
    });

    it('GET（actor の文書の取得）も Application actor の鍵で署名する', async () => {
        const sent = await send({ scheme: 'cavage', method: 'GET', path: '/users/bob' });
        expect(sent.headers.signature).toContain(`keyId="${A.appActorUrl}#main-key"`);
        expect(sent.headers.signature).toContain('headers="(request-target) host date accept"');
        expect(sent.headers.digest).toBeUndefined();
        const verifier = await verifierAt(T0);
        expect(await verifier.verify(received(sent), { allowCavage: true })).toMatchObject({ ok: true });
    });

    it('RFC 9421 を告知している相手（ubichill）と、nonce の要る RPC は RFC 9421 で送る', async () => {
        const ubichill = await send({ scheme: 'rfc9421' });
        expect(ubichill.headers['signature-input']).toMatch(/^sig1=/);
        const rpc = await send({ scheme: 'cavage', nonce: true });
        expect(rpc.headers['signature-input']).toMatch(/nonce=/);
        const verifier = await verifierAt(T0);
        expect(await verifier.verify(received(ubichill), { allowCavage: true })).toMatchObject({ ok: true });
    });
});
