/**
 * お気に入り一覧の公開範囲の純粋な知識。
 *
 * - private: 本人だけ
 * - friends: 本人と、承認済みのフレンド
 * - public : だれでも（ログイン不要。他サーバーからも取得できる）
 * 初期値は private（本人が選んだときだけ公開する）。
 */
import { z } from 'zod';

export const FAVORITES_VISIBILITIES = ['private', 'friends', 'public'] as const;
export const FavoritesVisibilitySchema = z.enum(FAVORITES_VISIBILITIES);
export type FavoritesVisibility = z.infer<typeof FavoritesVisibilitySchema>;

export const DEFAULT_FAVORITES_VISIBILITY: FavoritesVisibility = 'private';

export interface FavoritesViewer {
    /** 閲覧者が一覧の持ち主本人。 */
    isOwner: boolean;
    /** 閲覧者が持ち主の承認済みフレンド（ログインしていなければ false）。 */
    isFriend: boolean;
}

/** 閲覧者がお気に入り一覧を見てよいか。 */
export function canViewFavorites(visibility: FavoritesVisibility, viewer: FavoritesViewer): boolean {
    if (viewer.isOwner) return true;
    if (visibility === 'public') return true;
    if (visibility === 'friends') return viewer.isFriend;
    return false;
}

/** フレンドかどうかの確認（DB 参照）が要るのは、本人でなく、公開範囲が friends のときだけ。 */
export function needsFriendCheck(visibility: FavoritesVisibility, isOwner: boolean): boolean {
    return visibility === 'friends' && !isOwner;
}
