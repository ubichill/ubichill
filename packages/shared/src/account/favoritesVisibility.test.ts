import { describe, expect, it } from 'vitest';
import {
    canViewFavorites,
    DEFAULT_FAVORITES_VISIBILITY,
    FAVORITES_VISIBILITIES,
    FavoritesVisibilitySchema,
    needsFriendCheck,
} from './favoritesVisibility';

const owner = { isOwner: true, isFriend: false };
const friend = { isOwner: false, isFriend: true };
const stranger = { isOwner: false, isFriend: false };

describe('canViewFavorites', () => {
    it('private は本人だけ（フレンドにも見せない）', () => {
        expect(canViewFavorites('private', owner)).toBe(true);
        expect(canViewFavorites('private', friend)).toBe(false);
        expect(canViewFavorites('private', stranger)).toBe(false);
    });

    it('friends は本人と承認済みフレンドだけ', () => {
        expect(canViewFavorites('friends', owner)).toBe(true);
        expect(canViewFavorites('friends', friend)).toBe(true);
        expect(canViewFavorites('friends', stranger)).toBe(false);
    });

    it('public はだれでも（ログインしていない人を含む）', () => {
        for (const viewer of [owner, friend, stranger]) expect(canViewFavorites('public', viewer)).toBe(true);
    });

    it('どの公開範囲でも本人は見られる（公開範囲を絞っても自分のお気に入りが見えなくならない）', () => {
        for (const v of FAVORITES_VISIBILITIES) expect(canViewFavorites(v, owner)).toBe(true);
    });
});

describe('needsFriendCheck', () => {
    it('DB でフレンドを確認するのは、friends で、本人でないときだけ', () => {
        expect(needsFriendCheck('friends', false)).toBe(true);
        expect(needsFriendCheck('friends', true)).toBe(false);
        expect(needsFriendCheck('public', false)).toBe(false);
        expect(needsFriendCheck('private', false)).toBe(false);
    });
});

describe('FavoritesVisibilitySchema', () => {
    it('初期値は private（opt-in）で、3 つの値だけを受け付ける', () => {
        expect(DEFAULT_FAVORITES_VISIBILITY).toBe('private');
        expect(FavoritesVisibilitySchema.safeParse('friends').success).toBe(true);
        for (const bad of ['Public', 'everyone', '', null, undefined, 1]) {
            expect(FavoritesVisibilitySchema.safeParse(bad).success).toBe(false);
        }
    });
});
