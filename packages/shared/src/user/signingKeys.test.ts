import { describe, expect, it } from 'vitest';
import { activeSigningKeys, parseSigningKeyList, signingKeyStatus } from './signingKeys';

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
        account: 'hanako@ubichill.com',
        issuedAt: '2026-09-29T00:00:00.000Z',
        keys: [{ publicKey: K1, addedAt: '2026-09-01T00:00:00.000Z' }],
    };

    it('問い合わせたアカウントの一覧だけを採用する（ドメインの大文字小文字は同一視）', () => {
        expect(parseSigningKeyList(list, 'hanako@UbiChill.com')).toEqual(list);
        expect(parseSigningKeyList(list, 'evil@ubichill.com')).toBeUndefined();
        expect(parseSigningKeyList(list, 'hanako@evil.com')).toBeUndefined();
    });

    it('形式不正（鍵の形・日時・欠損）は採用しない', () => {
        expect(parseSigningKeyList({ ...list, keys: [{ publicKey: 'short' }] }, 'hanako@ubichill.com')).toBeUndefined();
        expect(
            parseSigningKeyList({ ...list, keys: [{ publicKey: K1, revokedAt: 'yesterday' }] }, 'hanako@ubichill.com'),
        ).toBeUndefined();
        expect(parseSigningKeyList({ account: list.account, keys: [] }, 'hanako@ubichill.com')).toBeUndefined();
        expect(parseSigningKeyList(null, 'hanako@ubichill.com')).toBeUndefined();
    });
});
