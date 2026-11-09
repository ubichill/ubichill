import { randomBytes } from 'node:crypto';
import { FEDERATION_LIMITS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { createFederationIdentity } from './identity';
import { createKeyring, type Keyring } from './keys';
import { createRsaKeyring, verifyRsaSha256 } from './rsaKeys';
import { createTransport } from './transport';
import { createVerifier, type InboundRequest, type VerifiableActor } from './verification';

const A = createFederationIdentity('https://a.example');
const B = createFederationIdentity('https://b.example');
const ALICE = A.actorUrl('alice');
const T0 = Date.parse('2026-11-08T00:00:00Z');

/** A のサーバーが keyring で署名して送った要求を、B が受けた形にする。 */
async function signedBy(keyring: Keyring, at: number): Promise<InboundRequest> {
    const captured: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const transport = createTransport({
        identity: A,
        keyring,
        // RFC 9421 だけを試す（RSA の鍵は作らない）
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
            now: () => at,
        }),
        schemeFor: async () => 'rfc9421',
        now: () => at,
        fetch: async (url, init) => {
            captured.push({ url, headers: init.headers, body: init.body });
            return new Response('', { status: 202 });
        },
    });
    await transport.post(
        `${B.origin}/ap/inbox`,
        { hello: 'world' },
        { signAs: { kind: 'user', userId: 'alice' }, ttlSec: 60, contentType: 'application/activity+json' },
    );
    const sent = captured[0];
    if (!sent) throw new Error('送っていない');
    const url = new URL(sent.url);
    const headers = Object.fromEntries(Object.entries(sent.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method: 'POST',
        originalUrl: url.pathname + url.search,
        header: (name) => headers[name.toLowerCase()],
        rawBody: new TextEncoder().encode(sent.body ?? ''),
    };
}

/** actor の文書に載る鍵（いまの鍵と、移行の間の前の鍵）。 */
const keysOf = (keyring: Keyring) => {
    const signer = keyring.signerFor(ALICE);
    return [
        { id: signer.keyId, publicKeyMultibase: signer.publicKeyMultibase },
        ...keyring.previousKeysFor(ALICE).map((k) => ({ id: k.keyId, publicKeyMultibase: k.publicKeyMultibase })),
    ];
};

/** B: A の actor の文書を覚えていて、取り直すと published（いま A が載せている鍵）を読む。 */
function receiver(
    cachedKeys: VerifiableActor['keys'],
    published: () => VerifiableActor['keys'],
    clock: { now: number },
) {
    const state = { cached: { id: ALICE, keys: cachedKeys, fetchedAt: new Date(T0), deletedAt: null }, refetches: 0 };
    const verifier = createVerifier<VerifiableActor>({
        identity: B,
        allowHttp: false,
        policyOf: () => 'allow',
        actors: {
            get: async (_id, options) => {
                if (options?.refresh) {
                    state.refetches++;
                    state.cached = { ...state.cached, keys: published(), fetchedAt: new Date(clock.now) };
                }
                return state.cached;
            },
        },
        seen: { remember: async () => true },
        crypto: { verifyEd25519: nodeWorldCrypto.verifyEd25519, verifyRsaSha256 },
        now: () => clock.now,
    });
    return { verifier, state };
}

describe('鍵の移行', () => {
    const oldSeed = randomBytes(32);
    const newSeed = randomBytes(32);
    const before = createKeyring({ seed: oldSeed });
    const after = createKeyring({ seed: newSeed, generation: 2, previousSeed: oldSeed });

    it('世代を上げると keyid が変わり、受け手は覚えた鍵が古くても 30 秒あけてすぐ取り直して通す（5 分待たない）', async () => {
        const clock = { now: T0 + 10_000 };
        const { verifier, state } = receiver(keysOf(before), () => keysOf(after), clock);
        // 取ってから 10 秒: 取り直しすぎない（知らない keyid を送り付けて取り直させ続けられない）
        expect(await verifier.verify(await signedBy(after, clock.now))).toMatchObject({ ok: false, status: 401 });
        clock.now = T0 + FEDERATION_LIMITS.UNKNOWN_KEY_REFETCH_MS + 1000;
        expect(await verifier.verify(await signedBy(after, clock.now))).toMatchObject({ ok: true });
        expect(state.refetches).toBe(1);
    });

    it('移行の間は前の鍵も載せるので、取り直した後でも前の鍵の署名（移行前に送った分）が通る', async () => {
        const clock = { now: T0 + 60_000 };
        const { verifier } = receiver(keysOf(after), () => keysOf(after), clock);
        expect(await verifier.verify(await signedBy(before, clock.now))).toMatchObject({ ok: true });
    });

    it('前の種を外すと、前の鍵は載らない', () => {
        const done = createKeyring({ seed: newSeed, generation: 2 });
        expect(done.signerFor(ALICE).keyId).toBe(`${ALICE}#ed25519-2`);
        expect(done.signerFor(ALICE).publicKeyMultibase).toBe(after.signerFor(ALICE).publicKeyMultibase);
        // 同じ種の前の世代（種を差し替えずに世代だけ上げたとき）だけが載る
        expect(done.previousKeysFor(ALICE)[0]?.publicKeyMultibase).not.toBe(keysOf(before)[0]?.publicKeyMultibase);
        expect(createKeyring({ seed: newSeed }).previousKeysFor(ALICE)).toEqual([]);
    });

    it('前の種を置くなら世代を上げていないと起動しない（keyid が重なる）', () => {
        expect(() => createKeyring({ seed: newSeed, previousSeed: oldSeed })).toThrow();
    });
});
