import { describe, expect, it } from 'vitest';
import { type AuthorKeyRow, localKeyOf, remoteKeyRowsOf } from './authorKeyRows';

const KEY = 'zrAOWmvHfxcn2wxizz6yonJ_OmzgO6eIdPdTFgBUwng';
const KEY_STANDARD = 'zrAOWmvHfxcn2wxizz6yonJ/OmzgO6eIdPdTFgBUwng=';
const KEY_EXTRA_BITS = 'zrAOWmvHfxcn2wxizz6yonJ_OmzgO6eIdPdTFgBUwnh';
const OTHER = 'A'.repeat(43);
const FETCHED = new Date('2026-10-10T00:00:00.000Z');

describe('remoteKeyRowsOf', () => {
    it('鍵を正規化し、addedAt を作成時刻にする（無ければ確認時刻）', () => {
        expect(
            remoteKeyRowsOf(
                [{ publicKey: KEY_STANDARD, addedAt: '2026-09-01T00:00:00.000Z' }, { publicKey: OTHER }],
                FETCHED,
            ),
        ).toEqual([
            { publicKey: KEY, createdAt: new Date('2026-09-01T00:00:00.000Z'), revokedAt: null },
            { publicKey: OTHER, createdAt: FETCHED, revokedAt: null },
        ]);
    });

    it('書き方が違うだけの同じ鍵は 1 行にまとめ、どれか 1 つでも取り消されていれば取り消し（いちばん早い時刻）', () => {
        const rows = remoteKeyRowsOf(
            [
                { publicKey: KEY, addedAt: '2026-09-02T00:00:00.000Z' },
                { publicKey: `ed25519:${KEY_EXTRA_BITS}`, revokedAt: '2026-09-20T00:00:00.000Z' },
                { publicKey: KEY_STANDARD, addedAt: '2026-09-01T00:00:00.000Z', revokedAt: '2026-09-10T00:00:00.000Z' },
            ],
            FETCHED,
        );
        expect(rows).toEqual([
            {
                publicKey: KEY,
                createdAt: new Date('2026-09-01T00:00:00.000Z'),
                revokedAt: new Date('2026-09-10T00:00:00.000Z'),
            },
        ]);
    });

    it('取り消しの時刻が読めなくても有効に戻さない（確認時刻で取り消す）。読めない鍵は捨てる', () => {
        expect(
            remoteKeyRowsOf(
                [
                    { publicKey: KEY, revokedAt: 'yesterday' },
                    { publicKey: 'short' },
                    { publicKey: OTHER, addedAt: 'not a date' },
                ],
                FETCHED,
            ),
        ).toEqual([
            { publicKey: KEY, createdAt: FETCHED, revokedAt: FETCHED },
            { publicKey: OTHER, createdAt: FETCHED, revokedAt: null },
        ]);
    });

    it('空の一覧は空（アカウントはあるが鍵が無い）', () => {
        expect(remoteKeyRowsOf([], FETCHED)).toEqual([]);
    });
});

describe('localKeyOf', () => {
    const row: AuthorKeyRow = {
        id: 'k1',
        account: null,
        algorithm: 'ed25519',
        publicKey: KEY,
        origin: 'local',
        userId: 'u1',
        kind: 'browser',
        name: 'Chrome on Mac',
        apiTokenHash: null,
        createdAt: FETCHED,
        lastUsedAt: null,
        fetchedAt: null,
        revokedAt: null,
        revokeReason: null,
    };

    it('自サーバーの行を公開環境の形にする', () => {
        expect(localKeyOf({ ...row, revokedAt: FETCHED, revokeReason: 'compromised' })).toMatchObject({
            id: 'k1',
            userId: 'u1',
            kind: 'browser',
            revokeReason: 'compromised',
        });
    });

    it('他サーバーの行や、必要な列が欠けた行は公開環境として扱わない', () => {
        expect(() => localKeyOf({ ...row, origin: 'remote', userId: null, account: 'a@other.example' })).toThrow();
        expect(() => localKeyOf({ ...row, kind: null })).toThrow();
    });

    it('知らない取り消しの理由は理由なしとして返す（理由で署名し直しの対象を決めるので推測しない）', () => {
        expect(localKeyOf({ ...row, revokedAt: FETCHED, revokeReason: 'other' }).revokeReason).toBeNull();
    });
});
