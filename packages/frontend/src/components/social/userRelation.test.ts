import { describe, expect, it } from 'vitest';
import { userRelationOf } from './userRelation';

describe('userRelationOf', () => {
    it('このサーバーの人はフレンドの関係だけ（ほかのサーバーの項目を付けない）', () => {
        expect(userRelationOf({ id: 'u1', friendship: 'friends' })).toEqual({ friendship: 'friends', relation: {} });
    });

    it('フレンドに対応していないサーバーで、フォローの承認待ちの人', () => {
        expect(
            userRelationOf({
                id: 'https://misskey.example/users/a',
                friendship: 'none',
                friendsUnsupported: true,
                followsYou: 'pending',
            }),
        ).toEqual({ friendship: 'none', relation: { friendsUnsupported: true, followsYou: 'pending' } });
    });

    it('プロフィールのほかの項目を関係に混ぜない', () => {
        const profile = { id: 'u2', friendship: 'none' as const, name: 'x', bio: 'y', followsYou: undefined };
        expect(userRelationOf(profile).relation).toEqual({});
    });
});
