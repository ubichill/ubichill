import { describe, expect, it } from 'vitest';
import { activeSigningKeys, normalizeEd25519PublicKey, parseSigningKeyList, signingKeyStatus } from './signingKeys';

const K1 = 'A'.repeat(43);
const K2 = 'B'.repeat(43);
const REVOKED = '2026-09-01T00:00:00.000Z';

describe('signingKeyStatus', () => {
    it('一覧に無い鍵は unknown、取り消し付きは revoked、それ以外は active', () => {
        const keys = [{ publicKey: K1 }, { publicKey: K2, revokedAt: REVOKED }];
        expect(signingKeyStatus(keys, K1)).toBe('active');
        expect(signingKeyStatus(keys, K2)).toBe('revoked');
        expect(signingKeyStatus(keys, 'C'.repeat(43))).toBe('unknown');
    });

    it('同じ鍵が有効と取り消しの両方で載っていたら取り消しを優先する（取り消しは覆らない）', () => {
        expect(signingKeyStatus([{ publicKey: K1 }, { publicKey: K1, revokedAt: REVOKED }], K1)).toBe('revoked');
        expect(
            activeSigningKeys([{ publicKey: K1 }, { publicKey: K1, revokedAt: REVOKED }, { publicKey: K2 }]),
        ).toEqual([K2]);
    });
});

describe('parseSigningKeyList', () => {
    const list = {
        account: 'youkan@ubichill.com',
        issuedAt: '2026-09-29T00:00:00.000Z',
        keys: [{ publicKey: K1, addedAt: '2026-09-01T00:00:00.000Z' }],
    };

    it('問い合わせたアカウントの一覧だけを採用する（ドメインの大文字小文字は同一視）', () => {
        expect(parseSigningKeyList(list, 'youkan@UbiChill.com')).toEqual(list);
        expect(parseSigningKeyList(list, 'evil@ubichill.com')).toBeUndefined();
        expect(parseSigningKeyList(list, 'youkan@evil.com')).toBeUndefined();
    });

    it('形式不正（鍵の形・日時・欠損）は採用しない', () => {
        expect(parseSigningKeyList({ ...list, keys: [{ publicKey: 'short' }] }, 'youkan@ubichill.com')).toBeUndefined();
        expect(
            parseSigningKeyList({ ...list, keys: [{ publicKey: K1, revokedAt: 'yesterday' }] }, 'youkan@ubichill.com'),
        ).toBeUndefined();
        expect(parseSigningKeyList({ account: list.account, keys: [] }, 'youkan@ubichill.com')).toBeUndefined();
        expect(parseSigningKeyList(null, 'youkan@ubichill.com')).toBeUndefined();
    });
});

describe('normalizeEd25519PublicKey', () => {
    // 実際の鍵（node の generateKeyPairSync('ed25519') の x）。43 文字目 g は下位 2 bit が 0
    const KEY = 'zrAOWmvHfxcn2wxizz6yonJ_OmzgO6eIdPdTFgBUwng';
    const STANDARD = 'zrAOWmvHfxcn2wxizz6yonJ/OmzgO6eIdPdTFgBUwng=';

    it('正規形はそのまま返す', () => {
        expect(normalizeEd25519PublicKey(KEY)).toBe(KEY);
        expect(normalizeEd25519PublicKey('A'.repeat(43))).toBe('A'.repeat(43));
    });

    it('接頭辞・標準の base64・パディングの違いは同じ鍵に揃える', () => {
        for (const variant of [`ed25519:${KEY}`, STANDARD, `ed25519:${STANDARD}`, `${KEY}=`, STANDARD.slice(0, -1)]) {
            expect(normalizeEd25519PublicKey(variant)).toBe(KEY);
        }
    });

    it('32 byte に入らない余りの bit が違うだけの書き方は同じ鍵にする（復号すると同じ鍵になる）', () => {
        for (const last of ['g', 'h', 'i', 'j']) {
            expect(normalizeEd25519PublicKey(`${KEY.slice(0, 42)}${last}`)).toBe(KEY);
        }
        expect(normalizeEd25519PublicKey(`${KEY.slice(0, 42)}k`)).not.toBe(KEY);
        expect(normalizeEd25519PublicKey('B'.repeat(43))).toBe(`${'B'.repeat(42)}A`);
        expect(normalizeEd25519PublicKey(`${'A'.repeat(42)}_`)).toBe(`${'A'.repeat(42)}8`);
    });

    it('長さ・文字・接頭辞の形が違うものは読めない', () => {
        for (const bad of [
            '',
            'A'.repeat(42),
            'A'.repeat(44),
            `${'A'.repeat(43)}==`,
            `${'A'.repeat(42)}=`,
            `${'A'.repeat(42)}.`,
            `ED25519:${KEY}`,
            `ed25519:ed25519:${KEY}`,
            ` ${KEY}`,
            `${KEY}\n`,
        ]) {
            expect(normalizeEd25519PublicKey(bad)).toBeUndefined();
        }
    });

    it('正規化した値は何度通しても変わらない', () => {
        const once = normalizeEd25519PublicKey(`${STANDARD.slice(0, 42)}/`);
        expect(once).toBeDefined();
        expect(normalizeEd25519PublicKey(once ?? '')).toBe(once);
    });
});
