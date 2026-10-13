/**
 * 署名の形式（docs/PROTOCOLS.md の A. 外に出るデータ）を固定するテスト。本物の Ed25519（WebCrypto）で確かめる。
 *
 * テストベクター（shared/src/signature/vectors.v2.json）は書き換えない。ここが落ちたら、署名する値の作り方が変わっている。
 * 外に出した署名が読めなくなるので、形式を変えるなら版を上げ、新しい版のベクターを足す（古い版のベクターは残す）。
 */
import {
    type ModLockEntry,
    signaturePayload,
    signMod,
    signWorld,
    verifyModSignature,
    verifyWorldSignature,
    type WorldDocument,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import vectors from '../../shared/src/signature/vectors.v2.json' with { type: 'json' };
import { importSigningKey, webWorldCrypto } from './worldCrypto';

const confirmed = async (author: string, publicKey: string) =>
    author === vectors.author && publicKey === vectors.publicKey
        ? ({ status: 'confirmed' } as const)
        : ({ status: 'unconfirmed' } as const);

describe('署名の形式 v2 のテストベクター', () => {
    it('ワールドの署名の例は、いつまでも検証できる', async () => {
        const verdict = await verifyWorldSignature(
            vectors.world.document as WorldDocument,
            vectors.world.signature,
            webWorldCrypto,
            confirmed,
        );
        expect(verdict).toMatchObject({ status: 'verified', author: vectors.author, publicKey: vectors.publicKey });
    });

    it('mod の署名の例は、いつまでも検証できる', async () => {
        const verdict = await verifyModSignature(
            vectors.mod.entry as ModLockEntry,
            vectors.mod.signature,
            webWorldCrypto,
            confirmed,
        );
        expect(verdict).toMatchObject({ status: 'verified', author: vectors.author });
    });

    it('署名する値のバイト列が変わっていない（同じ鍵・同じ対象から同じ署名ができる。Ed25519 は決定的）', async () => {
        const key = await importSigningKey(vectors.signingKeyPkcs8);
        const world = await signWorld(vectors.world.document as WorldDocument, key, webWorldCrypto, {
            author: vectors.author,
        });
        const mod = await signMod(vectors.mod.entry as ModLockEntry, key, webWorldCrypto, { author: vectors.author });
        expect(world).toEqual(vectors.world.signature);
        expect(mod).toEqual(vectors.mod.signature);
        const { signature: _w, ...worldFields } = world;
        const { signature: _m, ...modFields } = mod;
        expect(signaturePayload(worldFields)).toBe(vectors.world.payload);
        expect(signaturePayload(modFields)).toBe(vectors.mod.payload);
    });
});
