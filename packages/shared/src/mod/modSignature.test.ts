import { describe, expect, it } from 'vitest';
import { type ModLockEntry, ModLockEntrySchema } from '../schemas/modLock.schema';
import { signaturePayload, signEnvelope } from '../signature/envelope';
import type { AuthorKeyCheck, WorldCrypto, WorldSigningKey } from '../world/identity';
import { modContentHash, signMod, verifyModSignature } from './modSignature';

// shared は Node/DOM 非依存なので、判定ロジックは決定的な偽暗号で検証する（本物の ed25519 は backend と CLI のテスト）。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = `${B64.slice(0, 62)}-_`;
const fnv = (text: string, seed: number): number =>
    Array.from(text).reduce((h, ch) => Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0, seed >>> 0);
const fakeDigest = (text: string, length: number, alphabet: string): string =>
    Array.from({ length }, (_, i) => alphabet[fnv(text, 2166136261 + i * 7919) % 64]).join('');
const fakeSignature = (publicKey: string, message: string): string =>
    fakeDigest(`${publicKey}\0${message}`, 86, B64URL);
const crypto: WorldCrypto = {
    sha256Base64: async (text) => `${fakeDigest(text, 43, B64)}=`,
    verifyEd25519: async (publicKey, message, signature) => signature === fakeSignature(publicKey, message),
};
const keyOf = (label: string): WorldSigningKey => {
    const publicKey = fakeDigest(`key-${label}`, 43, B64URL);
    return { publicKey, sign: async (message) => fakeSignature(publicKey, message) };
};

const integrity = (label: string) => `sha256-${fakeDigest(label, 43, B64)}=`;
const entry = (overrides: Partial<ModLockEntry> = {}): ModLockEntry => ({
    id: 'pen',
    version: '2.0.1',
    manifestIntegrity: integrity('manifest'),
    components: {
        'pen:pen': { workerUrl: './pen/index.abc.js', integrity: integrity('worker'), capabilities: ['scene:read'] },
    },
    ...overrides,
});

const AUTHOR = 'alice@example.com';
const key = keyOf('alice');
const confirms =
    (author: string, publicKey: string): AuthorKeyCheck =>
    async (a, k) =>
        a === author && k === publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' };
const aliceOnly = confirms(AUTHOR, key.publicKey);

describe('verifyModSignature', () => {
    it('作者の鍵で署名した lock は、その作者として確認できる', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        const verdict = await verifyModSignature(entry(), signature, crypto, aliceOnly);
        expect(verdict).toMatchObject({ status: 'verified', author: AUTHOR, publicKey: key.publicKey });
    });

    it('署名が無ければ実行できない', async () => {
        expect(await verifyModSignature(entry(), undefined, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'signature-missing',
        });
        expect(await verifyModSignature(entry(), null, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'signature-missing',
        });
    });

    it('置き場所（baseUrl）が違っても同じ署名で確かめられる', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        const moved = entry({ baseUrl: 'https://mirror.example/mods' });
        expect((await verifyModSignature(moved, signature, crypto, aliceOnly)).status).toBe('verified');
    });

    it('スキーマの既定値で補った lock と、明示した lock は同じ内容として扱う', async () => {
        const raw = { id: 'data-only', version: '1.0.0', manifestIntegrity: integrity('m') };
        const signature = await signMod(ModLockEntrySchema.parse(raw), key, crypto, { author: AUTHOR });
        const explicit = ModLockEntrySchema.parse({ ...raw, components: {} });
        expect((await verifyModSignature(explicit, signature, crypto, aliceOnly)).status).toBe('verified');
    });

    it.each([
        [
            'worker の hash',
            entry({ components: { 'pen:pen': { ...entry().components['pen:pen'], integrity: integrity('evil') } } }),
        ],
        ['manifest の hash', entry({ manifestIntegrity: integrity('evil') })],
        [
            '権限の上限（追加）',
            entry({
                components: {
                    'pen:pen': { ...entry().components['pen:pen'], capabilities: ['scene:read', 'net:fetch'] },
                },
            }),
        ],
        [
            '権限の上限（削除）',
            entry({ components: { 'pen:pen': { ...entry().components['pen:pen'], capabilities: [] } } }),
        ],
        [
            'worker の場所',
            entry({ components: { 'pen:pen': { ...entry().components['pen:pen'], workerUrl: './x.js' } } }),
        ],
        [
            'Component の追加',
            entry({
                components: {
                    ...entry().components,
                    'pen:evil': { workerUrl: './evil.js', integrity: integrity('evil'), capabilities: [] },
                },
            }),
        ],
    ])('署名後に %s を変えた lock は通らない', async (_label, tampered) => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        expect(await verifyModSignature(tampered, signature, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'signature-content-mismatch',
        });
    });

    it('別の mod・別の版の署名は使い回せない', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        for (const other of [entry({ id: 'pen2' }), entry({ version: '2.0.2' })]) {
            expect(await verifyModSignature(other, signature, crypto, aliceOnly)).toEqual({
                status: 'rejected',
                reason: 'signature-mod-mismatch',
            });
        }
    });

    it('署名の作者だけを書き換えても通らない（作者は署名対象）', async () => {
        const mallory = keyOf('mallory');
        const signature = await signMod(entry(), mallory, crypto, { author: 'mallory@example.com' });
        const forged = { ...signature, author: AUTHOR };
        expect(await verifyModSignature(entry(), forged, crypto, confirms(AUTHOR, mallory.publicKey))).toEqual({
            status: 'rejected',
            reason: 'signature-invalid',
        });
    });

    it('他人の作者アカウントを名乗って自分の鍵で署名しても、作者として確認されない', async () => {
        const mallory = keyOf('mallory');
        const signature = await signMod(entry(), mallory, crypto, { author: AUTHOR });
        expect(await verifyModSignature(entry(), signature, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'author-unconfirmed',
        });
    });

    it('作者を確認する手段が無ければ実行できない（鍵だけの署名を認めない）', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        expect(await verifyModSignature(entry(), signature, crypto)).toEqual({
            status: 'rejected',
            reason: 'author-unconfirmed',
        });
    });

    it('作者をいま確認できない・確認が例外で落ちたときは pending（確認済みにしない）', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        const pending: AuthorKeyCheck = async () => ({ status: 'pending' });
        const throws: AuthorKeyCheck = async () => {
            throw new Error('db down');
        };
        for (const check of [pending, throws]) {
            expect(await verifyModSignature(entry(), signature, crypto, check)).toEqual({
                status: 'rejected',
                reason: 'author-pending',
            });
        }
    });

    it.each([
        'alice@EXAMPLE.COM',
        '@alice@example.com',
        'acct:alice@example.com',
        ' alice@example.com',
        'alice@example.com ',
    ])('作者の表記の揺れ（%j）は、鍵が正しくても形式不正（読む側でも受け付けない）', async (author) => {
        const fields = {
            format: 'ubichill-signature',
            version: 2,
            kind: 'mod',
            alg: 'ed25519',
            publicKey: key.publicKey,
            author,
            subject: entry().id,
            subjectVersion: entry().version,
            contentHash: await modContentHash(entry(), crypto),
        } as const;
        const forged = { ...fields, signature: await key.sign(signaturePayload(fields)) };
        const anyAuthor: AuthorKeyCheck = async () => ({ status: 'confirmed' });
        expect(await verifyModSignature(entry(), forged, crypto, anyAuthor)).toEqual({
            status: 'rejected',
            reason: 'signature-malformed',
        });
    });

    it('作者アカウントの無い署名・kind の無い署名は形式不正', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        const { author: _author, ...withoutAuthor } = signature;
        const { kind: _kind, ...withoutKind } = signature;
        for (const raw of [withoutAuthor, withoutKind, { ...signature, kind: 'world' }, 'text', 42, []]) {
            expect(await verifyModSignature(entry(), raw, crypto, aliceOnly)).toEqual({
                status: 'rejected',
                reason: 'signature-malformed',
            });
        }
    });

    it('内容・署名の照合に失敗したら、作者の確認（他サーバーへの問い合わせ）をしない', async () => {
        const calls: string[] = [];
        const spy: AuthorKeyCheck = async (author) => {
            calls.push(author);
            return { status: 'confirmed' };
        };
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        await verifyModSignature(entry({ manifestIntegrity: integrity('evil') }), signature, crypto, spy);
        await verifyModSignature(entry(), { ...signature, signature: 'A'.repeat(86) }, crypto, spy);
        expect(calls).toEqual([]);
    });

    it('他サーバーの作者は確認時刻を引き継ぐ', async () => {
        const signature = await signMod(entry(), key, crypto, { author: AUTHOR });
        const checkedAt = '2026-10-01T00:00:00.000Z';
        const verdict = await verifyModSignature(entry(), signature, crypto, async () => ({
            status: 'confirmed',
            checkedAt,
        }));
        expect(verdict).toMatchObject({ status: 'verified', authorCheckedAt: checkedAt });
    });
});

describe('種類の分離（共通の形式の kind）', () => {
    it('同じ名前・同じ内容のハッシュでも、ワールドの署名を mod の署名として出すと通らない', async () => {
        const contentHash = await modContentHash(entry(), crypto);
        const asWorld = await signEnvelope({ kind: 'world', subject: 'pen', contentHash }, key, AUTHOR);
        expect(await verifyModSignature(entry(), asWorld, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'signature-malformed',
        });
        // kind だけを書き換えると署名が合わない（kind は署名する値に入る）
        expect(
            await verifyModSignature(
                entry(),
                { ...asWorld, kind: 'mod', subjectVersion: entry().version },
                crypto,
                aliceOnly,
            ),
        ).toEqual({ status: 'rejected', reason: 'signature-invalid' });
    });

    it('ワールドの署名と mod の署名の署名する値は、別のバイト列になる', async () => {
        const contentHash = await modContentHash(entry(), crypto);
        const fields = {
            format: 'ubichill-signature',
            version: 2,
            alg: 'ed25519',
            publicKey: key.publicKey,
            author: AUTHOR,
            subject: 'pen',
            contentHash,
        } as const;
        expect(signaturePayload({ ...fields, kind: 'mod', subjectVersion: '2.0.1' })).not.toBe(
            signaturePayload({ ...fields, kind: 'world' }),
        );
    });

    it('版 1 の形式（以前の mod の署名）は読み続けない（署名し直す）', async () => {
        const v1 = {
            version: 1,
            alg: 'ed25519',
            kind: 'mod',
            publicKey: key.publicKey,
            name: entry().id,
            modVersion: entry().version,
            contentHash: await modContentHash(entry(), crypto),
            author: AUTHOR,
        };
        const legacy = { ...v1, signature: await key.sign(JSON.stringify(v1)) };
        expect(await verifyModSignature(entry(), legacy, crypto, aliceOnly)).toEqual({
            status: 'rejected',
            reason: 'signature-malformed',
        });
    });

    it('新しく署名するときは、正規の表記でない作者を断る', async () => {
        for (const author of [
            'alice@EXAMPLE.COM',
            '@alice@example.com',
            'acct:alice@example.com',
            ' alice@example.com',
        ]) {
            await expect(signMod(entry(), key, crypto, { author })).rejects.toThrow('正規の表記');
        }
    });
});
