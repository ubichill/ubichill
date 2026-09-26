import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    signWorld,
    verifyWorldSignature,
    type WorldCrypto,
    type WorldDocument,
    type WorldSigningKey,
    worldContentHash,
    worldIdOf,
} from './identity';

// shared は Node/DOM 非依存なので、判定ロジックは決定的な偽暗号で検証する。
// 本物の ed25519/sha256 を通した検証は backend の worldResolver.test.ts が担う。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = `${B64.slice(0, 62)}-_`;

const fnv = (text: string, seed: number): number =>
    Array.from(text).reduce((h, ch) => Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0, seed >>> 0);

const fakeDigest = (text: string, length: number, alphabet: string): string =>
    Array.from({ length }, (_, i) => alphabet[fnv(text, 2166136261 + i * 7919) % 64]).join('');

const fakeSignature = (publicKey: string, message: string): string =>
    fakeDigest(`${publicKey}\0${message}`, 86, B64URL);

const fakeCrypto: WorldCrypto = {
    sha256Base64: async (text) => `${fakeDigest(text, 43, B64)}=`,
    verifyEd25519: async (publicKey, message, signature) => signature === fakeSignature(publicKey, message),
};

const keySeq = { n: 0 };
function newKey(): WorldSigningKey {
    keySeq.n += 1;
    const publicKey = fakeDigest(`key-${keySeq.n}`, 43, B64URL);
    return { publicKey, sign: async (message) => fakeSignature(publicKey, message) };
}

const baseDoc = (): WorldDocument => ({
    definition: {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'my-world', version: '1.0.0', author: { name: 'alice' } },
        spec: { displayName: 'ワールド', initialEntities: [{ kind: 'pen:pen', transform: { x: 1.5, y: -0 } }] },
    },
    lock: { lockVersion: 1, mods: { pen: { id: 'pen', version: '1.0.0' } } },
});

describe('canonicalJson', () => {
    it('キー順に依存しない', () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
        expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    it('キーは UTF-16 コード単位順（localeCompare ではない）', () => {
        expect(canonicalJson({ b: 1, B: 2, あ: 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"あ":3}');
    });

    it('JSON.stringify と同じく object の undefined は落とし、配列の undefined は null', () => {
        expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
    });

    it('-0 は 0 に正規化される', () => {
        expect(canonicalJson(-0)).toBe('0');
    });

    it('非有限数・非プレーン object・bigint は曖昧なので throw', () => {
        expect(() => canonicalJson(Number.NaN)).toThrow();
        expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
        expect(() => canonicalJson({ at: new Date(0) })).toThrow();
        expect(() => canonicalJson(new Map())).toThrow();
        expect(() => canonicalJson(1n)).toThrow();
        expect(() => canonicalJson(undefined)).toThrow();
    });

    it('文字列のエスケープが JSON 互換', () => {
        expect(canonicalJson('a"\n\\')).toBe(JSON.stringify('a"\n\\'));
    });
});

describe('worldContentHash', () => {
    it('lock 未指定と null は同じ', async () => {
        const { definition } = baseDoc();
        expect(await worldContentHash({ definition }, fakeCrypto)).toBe(
            await worldContentHash({ definition, lock: null }, fakeCrypto),
        );
    });

    it('シリアライズして読み戻しても一致する（配信経路の再シリアライズに耐える）', async () => {
        const doc = baseDoc();
        const roundTripped = JSON.parse(JSON.stringify(doc)) as WorldDocument;
        expect(await worldContentHash(roundTripped, fakeCrypto)).toBe(await worldContentHash(doc, fakeCrypto));
    });

    it('lock だけの変更でも変わる', async () => {
        const doc = baseDoc();
        const changed = { ...doc, lock: { lockVersion: 1, mods: {} } };
        expect(await worldContentHash(changed, fakeCrypto)).not.toBe(await worldContentHash(doc, fakeCrypto));
    });
});

describe('signWorld / verifyWorldSignature', () => {
    it('署名したものは verified になり worldId は 公開鍵 + name', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto);
        const verdict = await verifyWorldSignature(doc, sig, fakeCrypto);
        expect(verdict).toEqual({
            status: 'verified',
            worldId: worldIdOf(key.publicKey, 'my-world'),
            publicKey: key.publicKey,
            contentHash: sig.contentHash,
        });
    });

    it('URL が変わっても（＝同じデータを別経路で受け取っても）同じ worldId', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto);
        const mirrored = JSON.parse(JSON.stringify(doc)) as WorldDocument;
        const a = await verifyWorldSignature(doc, sig, fakeCrypto);
        const b = await verifyWorldSignature(mirrored, JSON.parse(JSON.stringify(sig)), fakeCrypto);
        expect(b).toEqual(a);
    });

    it('署名が無ければ unsigned（contentHash は付く）', async () => {
        const doc = baseDoc();
        expect(await verifyWorldSignature(doc, undefined, fakeCrypto)).toEqual({
            status: 'unsigned',
            contentHash: await worldContentHash(doc, fakeCrypto),
        });
    });

    it('definition を 1 文字でも改竄すると content-mismatch', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const tampered = JSON.parse(JSON.stringify(doc)) as { definition: { spec: { displayName: string } } };
        tampered.definition.spec.displayName = 'ワールト';
        expect(await verifyWorldSignature(tampered, sig, fakeCrypto)).toEqual({
            status: 'invalid',
            reason: 'content-mismatch',
        });
    });

    it('lock を差し替え・削除すると content-mismatch（配信元乗っ取りで lock ごと偽装できない）', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature({ definition: doc.definition }, sig, fakeCrypto)).toMatchObject({
            reason: 'content-mismatch',
        });
        const swapped = { definition: doc.definition, lock: { lockVersion: 1, mods: { evil: { id: 'pen' } } } };
        expect(await verifyWorldSignature(swapped, sig, fakeCrypto)).toMatchObject({ reason: 'content-mismatch' });
    });

    it('攻撃者が改竄後に contentHash だけ書き換えても bad-signature', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const tampered = { definition: doc.definition, lock: null };
        const forged = { ...sig, contentHash: await worldContentHash(tampered, fakeCrypto) };
        expect(await verifyWorldSignature(tampered, forged, fakeCrypto)).toEqual({
            status: 'invalid',
            reason: 'bad-signature',
        });
    });

    it('他人の公開鍵に差し替える（作者のなりすまし）と bad-signature', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const impersonated = { ...sig, publicKey: newKey().publicKey };
        expect(await verifyWorldSignature(doc, impersonated, fakeCrypto)).toMatchObject({ reason: 'bad-signature' });
    });

    it('攻撃者が自分の鍵で署名し直すと verified だが worldId が別物になる', async () => {
        const doc = baseDoc();
        const original = await verifyWorldSignature(doc, await signWorld(doc, newKey(), fakeCrypto), fakeCrypto);
        const resigned = await verifyWorldSignature(doc, await signWorld(doc, newKey(), fakeCrypto), fakeCrypto);
        expect(resigned.status).toBe('verified');
        expect(original.status === 'verified' && resigned.status === 'verified' && resigned.worldId).not.toBe(
            original.status === 'verified' && original.worldId,
        );
    });

    it('別ワールドの署名を流用すると name-mismatch', async () => {
        const doc = baseDoc();
        const other = JSON.parse(JSON.stringify(doc)) as { definition: { metadata: { name: string } } };
        other.definition.metadata.name = 'other-world';
        const sigForOther = await signWorld(other, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sigForOther, fakeCrypto)).toMatchObject({ reason: 'name-mismatch' });
    });

    it('署名ファイルの形式が不正なら malformed（未署名への格下げはしない）', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        for (const bad of [{}, 'x', { ...sig, alg: 'rsa' }, { ...sig, version: 2 }, { ...sig, signature: 'AAAA' }]) {
            expect(await verifyWorldSignature(doc, bad, fakeCrypto)).toEqual({
                status: 'invalid',
                reason: 'malformed',
            });
        }
    });

    it('crypto 実装が throw しても bad-signature に倒す', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const throwing: WorldCrypto = {
            ...fakeCrypto,
            verifyEd25519: () => Promise.reject(new Error('boom')),
        };
        expect(await verifyWorldSignature(doc, sig, throwing)).toMatchObject({ reason: 'bad-signature' });
    });

    it('metadata.name の無いワールドには署名できない', async () => {
        await expect(signWorld({ definition: { metadata: {} } }, newKey(), fakeCrypto)).rejects.toThrow();
    });
});
