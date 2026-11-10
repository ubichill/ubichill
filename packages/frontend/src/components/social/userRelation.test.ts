import { describe, expect, it } from 'vitest';
import { relationAfterBlock, userRelationOf } from './userRelation';

describe('userRelationOf', () => {
    it('このサーバーの人はフレンドの関係だけ（ほかのサーバーの項目を付けない）', () => {
        expect(userRelationOf({ id: 'u1', friendship: 'friends' })).toEqual({
            friendship: 'friends',
            relation: {},
            blocked: false,
        });
    });

    it('フレンドに対応していないサーバーで、フォローの承認待ちの人', () => {
        expect(
            userRelationOf({
                id: 'https://misskey.example/users/a',
                friendship: 'none',
                friendsUnsupported: true,
                followsYou: 'pending',
            }),
        ).toEqual({
            friendship: 'none',
            relation: { friendsUnsupported: true, followsYou: 'pending' },
            blocked: false,
        });
    });

    it('プロフィールのほかの項目を関係に混ぜない', () => {
        const profile = { id: 'u2', friendship: 'none' as const, name: 'x', bio: 'y', followsYou: undefined };
        expect(userRelationOf(profile).relation).toEqual({});
    });
});

describe('ブロック', () => {
    it('ブロックしている人は blocked（true 以外の値は false）', () => {
        expect(userRelationOf({ id: 'u1', friendship: 'none', blocked: true }).blocked).toBe(true);
        expect(userRelationOf({ id: 'u1', friendship: 'none' }).blocked).toBe(false);
    });

    it('ブロックするとフレンドもフォローも消え、フレンドに対応していないことだけ残る', () => {
        expect(
            relationAfterBlock({
                friendship: 'friends',
                relation: { friendsUnsupported: true, followsYou: 'accepted' },
                blocked: false,
            }),
        ).toEqual({ friendship: 'none', relation: { friendsUnsupported: true }, blocked: true });
        expect(relationAfterBlock({ friendship: 'incoming', relation: {}, blocked: false })).toEqual({
            friendship: 'none',
            relation: {},
            blocked: true,
        });
    });
});
