import { randomBytes } from 'node:crypto';
import type { DomainPolicy } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldCrypto } from '../../worlds/worldCrypto';
import { createFederationIdentity, type FederationIdentity } from '../identity';
import { createKeyring } from './keys';
import { createRsaKeyring, verifyRsaSha256 } from './rsaKeys';
import { createTransport } from './transport';
import { createVerifier, type InboundRequest, type VerifiableActor } from './verification';
import type { WindowCounter } from './windowCounter';

const A = createFederationIdentity('https://a.example');
const B = createFederationIdentity('https://b.example');
const T0 = Date.parse('2026-11-09T00:00:00Z');
const keyring = createKeyring({ seed: randomBytes(32) });

/** from のサーバーの alice が B へ送った要求を、B が受けた形にする（RFC 9421・Ed25519）。 */
async function signedBy(from: FederationIdentity, options: { nonce?: boolean; ip?: string } = {}) {
    const captured: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
    const transport = createTransport({
        identity: from,
        keyring,
        rsaKeys: createRsaKeyring({
            seed: randomBytes(32),
            repo: {
                get: async () => undefined,
                insertIfAbsent: async () => {
                    throw new Error('使わない');
                },
                rewrap: async () => undefined,
                replace: async () => {
                    throw new Error('使わない');
                },
            },
            now: () => T0,
        }),
        schemeFor: async () => 'rfc9421',
        now: () => T0,
        fetch: async (url, init) => {
            captured.push({ url, headers: init.headers, body: init.body });
            return new Response('', { status: 202 });
        },
    });
    await transport.post(
        `${B.origin}/federation/v1/rooms/join`,
        { hello: 'world' },
        {
            signAs: { kind: 'user', userId: 'alice' },
            ttlSec: 60,
            contentType: 'application/json',
            nonce: options.nonce,
        },
    );
    const sent = captured[0];
    if (!sent) throw new Error('送っていない');
    const url = new URL(sent.url);
    const headers = Object.fromEntries(Object.entries(sent.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return (body = sent.body ?? ''): InboundRequest => ({
        method: 'POST',
        originalUrl: url.pathname + url.search,
        header: (name) => headers[name.toLowerCase()],
        rawBody: new TextEncoder().encode(body),
        ip: options.ip ?? '203.0.113.1',
    });
}

/** 数えるだけの窓（窓は進めない）。 */
const counter = (limit: number): WindowCounter & { counts: Map<string, number> } => {
    const counts = new Map<string, number>();
    return {
        counts,
        exceeded: async (key) => (counts.get(key) ?? 0) >= limit,
        take: async (key) => {
            const n = (counts.get(key) ?? 0) + 1;
            counts.set(key, n);
            return n <= limit;
        },
    };
};

/** B の受け口。知っている actor は無く、引くたびに（admitUnknown に尋ねてから）取りに行く。 */
function receiver(
    options: {
        identity?: FederationIdentity;
        policy?: DomainPolicy;
        deleted?: boolean;
        failures?: WindowCounter;
        unknownActors?: WindowCounter;
    } = {},
) {
    const fetched: string[] = [];
    const seen = new Set<string>();
    const verifier = createVerifier<VerifiableActor>({
        identity: options.identity ?? B,
        allowHttp: false,
        policyOf: () => options.policy ?? 'allow',
        actors: {
            get: async (id, getOptions) => {
                if (getOptions?.admitUnknown && !(await getOptions.admitUnknown())) return null;
                fetched.push(id);
                const signer = keyring.signerFor(id);
                return {
                    id,
                    keys: [{ id: signer.keyId, publicKeyMultibase: signer.publicKeyMultibase }],
                    fetchedAt: new Date(T0),
                    deletedAt: options.deleted ? new Date(T0) : null,
                };
            },
        },
        seen: {
            remember: async (key) => {
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            },
        },
        crypto: { verifyEd25519: nodeWorldCrypto.verifyEd25519, verifyRsaSha256 },
        failures: options.failures ?? counter(Number.POSITIVE_INFINITY),
        unknownActors: options.unknownActors ?? counter(Number.POSITIVE_INFINITY),
        now: () => T0,
    });
    return { verifier, fetched };
}

describe('受けた要求の署名を確かめる', () => {
    it('署名が通らなかった要求を IP ごとに数え、上限を超えた IP は確かめずに 429（actor も取りに行かない）', async () => {
        const failures = counter(2);
        const { verifier, fetched } = receiver({ failures });
        const attacker = await signedBy(A, { ip: '198.51.100.7' });
        expect(await verifier.verify(attacker('{"hello":"tampered"}'))).toMatchObject({ ok: false, status: 401 });
        expect(await verifier.verify(attacker('{"hello":"again"}'))).toMatchObject({ ok: false, status: 401 });
        // 上限に達した IP は、正しい署名でも確かめない
        const before = fetched.length;
        expect(await verifier.verify(attacker())).toMatchObject({ ok: false, status: 429 });
        expect(fetched).toHaveLength(before);
        // ほかの IP は通る。通った署名は数えない（1 つの IP から多く送ってくる正規の連合先を巻き込まない）
        const peer = await signedBy(A, { ip: '192.0.2.10' });
        for (const _ of [1, 2, 3, 4, 5]) expect(await verifier.verify(peer())).toMatchObject({ ok: true });
        expect(failures.counts.get('192.0.2.10')).toBeUndefined();
    });

    it('知らない actor の取得はサーバー全体で数え、ホスト名を変えても上限を超えたら取りに行かない', async () => {
        const { verifier, fetched } = receiver({ unknownActors: counter(2) });
        const hosts = ['a1.evil.example', 'a2.evil.example', 'a3.evil.example'];
        const results = [];
        for (const host of hosts) {
            results.push(await verifier.verify((await signedBy(createFederationIdentity(`https://${host}`)))()));
        }
        expect(results.map((r) => r.ok)).toEqual([true, true, false]);
        expect(fetched.map((id) => new URL(id).host)).toEqual(hosts.slice(0, 2));
    });

    it('nonce の要る要求は、同じ (keyid, nonce) の 2 度目を 401（replay）', async () => {
        const { verifier } = receiver();
        const request = (await signedBy(A, { nonce: true }))();
        expect(await verifier.verify(request, { requireNonce: true })).toMatchObject({ ok: true });
        expect(await verifier.verify(request, { requireNonce: true })).toEqual({
            ok: false,
            status: 401,
            reason: 'replay',
        });
    });

    it('keyid のホストを block していれば 403、自分のサーバーの鍵・消えた actor の署名は 401', async () => {
        const request = (await signedBy(A))();
        const blocked = receiver({ policy: 'block' });
        expect(await blocked.verifier.verify(request)).toEqual({ ok: false, status: 403, reason: 'blocked' });
        expect(blocked.fetched).toEqual([]);
        expect(await receiver({ identity: A }).verifier.verify(request)).toEqual({
            ok: false,
            status: 401,
            reason: 'self-signed',
        });
        expect(await receiver({ deleted: true }).verifier.verify(request)).toEqual({
            ok: false,
            status: 401,
            reason: 'actor',
        });
    });
});
