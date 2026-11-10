import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import type { ActorKeyRecord, NewActorKey } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { createRsaKeyring, unwrapPrivateKey, verifyRsaSha256, wrapPrivateKey } from './rsaKeys';

const ALICE = 'https://a.example/ap/users/alice';

/** 小さくない鍵で試す（2048 ビット未満は照合で断るため）。作るのは重いので使い回す。 */
const pairs = Array.from({ length: 3 }, () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKeyDer: privateKey.export({ type: 'pkcs8', format: 'der' }),
    };
});

function memoryRepo() {
    const rows = new Map<string, ActorKeyRecord>();
    return {
        rows,
        repo: {
            get: async (id: string) => rows.get(id),
            insertIfAbsent: async (key: NewActorKey, now: Date) => {
                if (!rows.has(key.actorId)) rows.set(key.actorId, { ...key, createdAt: now });
                return rows.get(key.actorId) as ActorKeyRecord;
            },
            rewrap: async (id: string, privateKeyEncrypted: string) => {
                const row = rows.get(id);
                if (row) rows.set(id, { ...row, privateKeyEncrypted });
            },
            replace: async (key: NewActorKey, unreadable: string, now: Date) => {
                const row = rows.get(key.actorId);
                if (row?.privateKeyEncrypted === unreadable) rows.set(key.actorId, { ...key, createdAt: now });
                return rows.get(key.actorId) as ActorKeyRecord;
            },
        },
    };
}

const generator = () => {
    const state = { made: 0 };
    return {
        state,
        generate: async () => {
            const pair = pairs[state.made % pairs.length];
            state.made++;
            if (!pair) throw new Error('鍵が無い');
            return pair;
        },
    };
};

const signs = (signer: { publicKeyPem: string; sign(data: Uint8Array): Uint8Array }) => {
    const data = Buffer.from('(request-target): post /inbox');
    return verify('sha256', data, signer.publicKeyPem, signer.sign(data));
};

describe('RSA の鍵（ほかの実装への署名）', () => {
    it('初めて要るときに作って保存し、同時に頼まれても 1 つだけ作る。keyId は #main-key', async () => {
        const { repo, rows } = memoryRepo();
        const { generate, state } = generator();
        const keyring = createRsaKeyring({ seed: randomBytes(32), repo, generate, now: () => 0 });
        const [a, b] = await Promise.all([keyring.signerFor(ALICE, 'alice'), keyring.signerFor(ALICE, 'alice')]);
        expect(state.made).toBe(1);
        expect(a).toBe(b);
        expect(a.keyId).toBe(`${ALICE}#main-key`);
        expect(rows.get(ALICE)?.userId).toBe('alice');
        expect(signs(a)).toBe(true);
        // 秘密鍵は平文で置かない
        expect(rows.get(ALICE)?.privateKeyEncrypted).not.toContain('PRIVATE KEY');
    });

    it('起動し直しても（キャッシュが無くても）同じ鍵を使う', async () => {
        const seed = randomBytes(32);
        const { repo } = memoryRepo();
        const { generate, state } = generator();
        const first = await createRsaKeyring({ seed, repo, generate, now: () => 0 }).signerFor(ALICE, 'alice');
        const again = await createRsaKeyring({ seed, repo, generate, now: () => 0 }).signerFor(ALICE, 'alice');
        expect(state.made).toBe(1);
        expect(again.publicKeyPem).toBe(first.publicKeyPem);
        expect(signs(again)).toBe(true);
    });

    it('種を差し替えたら、前の種で開けて包み直す（鍵は変わらない）', async () => {
        const oldSeed = randomBytes(32);
        const newSeed = randomBytes(32);
        const { repo, rows } = memoryRepo();
        const { generate, state } = generator();
        const before = await createRsaKeyring({ seed: oldSeed, repo, generate, now: () => 0 }).signerFor(ALICE, null);
        const after = await createRsaKeyring({
            seed: newSeed,
            previousSeed: oldSeed,
            repo,
            generate,
            now: () => 0,
        }).signerFor(ALICE, null);
        expect(state.made).toBe(1);
        expect(after.publicKeyPem).toBe(before.publicKeyPem);
        const wrapped = rows.get(ALICE)?.privateKeyEncrypted ?? '';
        expect(unwrapPrivateKey(wrapped, newSeed, ALICE)).not.toBeNull();
        expect(unwrapPrivateKey(wrapped, oldSeed, ALICE)).toBeNull();
    });

    it('どの種でも開けなければ作り直す（相手は署名が通らなければ文書を取り直す）', async () => {
        const { repo } = memoryRepo();
        const { generate, state } = generator();
        const before = await createRsaKeyring({ seed: randomBytes(32), repo, generate, now: () => 0 }).signerFor(
            ALICE,
            null,
        );
        const after = await createRsaKeyring({ seed: randomBytes(32), repo, generate, now: () => 0 }).signerFor(
            ALICE,
            null,
        );
        expect(state.made).toBe(2);
        expect(after.publicKeyPem).not.toBe(before.publicKeyPem);
        expect(signs(after)).toBe(true);
    });

    it('包んだ秘密鍵は、ほかの actor の行に写しても開けない', () => {
        const seed = randomBytes(32);
        const wrapped = wrapPrivateKey(pairs[0]?.privateKeyDer ?? Buffer.alloc(0), seed, ALICE);
        expect(unwrapPrivateKey(wrapped, seed, ALICE)).not.toBeNull();
        expect(unwrapPrivateKey(wrapped, seed, 'https://a.example/ap/users/mallory')).toBeNull();
        expect(unwrapPrivateKey('壊れた', seed, ALICE)).toBeNull();
    });
});

describe('verifyRsaSha256', () => {
    const pair = pairs[0];

    it('正しい署名だけを通し、崩れた鍵・RSA でない鍵・小さい鍵は false（投げない）', async () => {
        if (!pair) throw new Error('鍵が無い');
        const keyring = createRsaKeyring({
            seed: randomBytes(32),
            repo: memoryRepo().repo,
            generate: async () => pair,
            now: () => 0,
        });
        const signer = await keyring.signerFor(ALICE, null);
        const signature = signer.sign(Buffer.from('hello'));
        expect(await verifyRsaSha256(pair.publicKeyPem, 'hello', signature)).toBe(true);
        expect(await verifyRsaSha256(pair.publicKeyPem, 'hellO', signature)).toBe(false);
        expect(
            await verifyRsaSha256('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----', 'hello', signature),
        ).toBe(false);
        const ed = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
        expect(await verifyRsaSha256(ed, 'hello', signature)).toBe(false);
        const small = generateKeyPairSync('rsa', { modulusLength: 1024 });
        const smallSig = Uint8Array.from(sign('sha256', Buffer.from('hello'), small.privateKey));
        const smallPem = small.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        expect(await verifyRsaSha256(smallPem, 'hello', smallSig)).toBe(false);
    });
});
