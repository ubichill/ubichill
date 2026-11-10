/**
 * お気に入りのワールド（追加・削除・本人の一覧・ほかの人に見せる一覧）。公開範囲の規則は shared の favoritesVisibility、
 * worldRef の正規化と解決は favorites.ts。変わったら、ほかの backend のキャッシュと連合の固定ノートにも知らせる。
 */
import { favoriteRepository, userFriendRepository, userRepository, userSettingsRepository } from '@ubichill/db';
import {
    canViewFavorites,
    type FavoritesVisibility,
    LIMITS,
    needsFriendCheck,
    type WorldListItem,
} from '@ubichill/shared';
import { createTtlCache } from '../../utils/ttlCache';
import { backendEvents } from '../cluster/backendEvents';
import { federation } from '../federation';
import { notificationService, notifyInBackground } from '../notifications/notificationService';
import { favoriteRefOf, resolveFavoriteWorlds } from './favorites';
import { worldRegistry } from './worldRegistry';

const resolveWorlds = (refs: readonly string[]) =>
    resolveFavoriteWorlds([...refs], (ref) => worldRegistry.publishableListItem(ref));

// 呼ばれるたびに外部ワールドを取得し直さないよう、ユーザーごとに数分キャッシュする
// （キャッシュは解決したワールドだけで、閲覧の可否は毎回判定する。追加・削除で捨てる）
const publicFavoritesCache = createTtlCache<Awaited<ReturnType<typeof resolveWorlds>>>({
    ttlMs: 3 * 60 * 1000,
    max: 500,
});
backendEvents.on('favorites.changed', ({ userId }) => publicFavoritesCache.delete(userId));

const changed = (userId: string): void => {
    publicFavoritesCache.delete(userId);
    backendEvents.broadcast({ type: 'favorites.changed', userId });
    federation?.featuredChanged(userId);
};

export type AddFavoriteOutcome = { ok: true; worldRef: string } | { ok: false; status: 400 | 409; error: string };

export type PublicFavoritesOutcome =
    | { ok: true; worlds: WorldListItem[]; visibility: FavoritesVisibility }
    | { ok: false; reason: 'not-found' | 'hidden' };

export const favoriteService = {
    refs: (userId: string): Promise<string[]> => favoriteRepository.list(userId),

    /** 本人の一覧（作者まで確認できたもの。取得できないものは unavailable で返し整理できるようにする） */
    async worlds(userId: string) {
        return resolveWorlds(await favoriteRepository.list(userId));
    },

    /** 追加する（worldRef＝ワールドの URL。外部ワールドも可。共有 URL は正規化する）。作者に知らせる。 */
    async add(userId: string, rawRef: unknown): Promise<AddFavoriteOutcome> {
        const parsed = favoriteRefOf(rawRef);
        if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
        const existing = await favoriteRepository.list(userId);
        if (!existing.includes(parsed.ref) && existing.length >= LIMITS.MAX_FAVORITES_PER_USER) {
            return { ok: false, status: 409, error: `お気に入りは ${LIMITS.MAX_FAVORITES_PER_USER} 件までです` };
        }
        await favoriteRepository.add(userId, parsed.ref);
        changed(userId);
        notifyInBackground(
            worldRegistry
                .localWorldAuthor(parsed.ref)
                .then((world) => (world ? notificationService.worldLiked(userId, world) : undefined)),
            'お気に入り',
        );
        return { ok: true, worldRef: parsed.ref };
    },

    /** 削除する。登録時に正規化した形と、渡された形のどちらでも消せるようにする。 */
    async remove(userId: string, worldRef: string): Promise<void> {
        const parsed = favoriteRefOf(worldRef);
        await favoriteRepository.remove(userId, worldRef);
        if (parsed.ok && parsed.ref !== worldRef) await favoriteRepository.remove(userId, parsed.ref);
        changed(userId);
    },

    /** 公開範囲を変える。パブリックにした・やめたら、フェディバースの固定ノートのお気に入りも出す・消す。 */
    async setVisibility(userId: string, visibility: FavoritesVisibility): Promise<void> {
        await userSettingsRepository.setFavoritesVisibility(userId, visibility);
        federation?.featuredChanged(userId);
    },

    /** ほかの人に見せる一覧。公開範囲を絞っているなら、見てよい人以外には中身も件数も返さない。 */
    async visibleTo(viewerId: string | undefined, userId: string): Promise<PublicFavoritesOutcome> {
        const user = await userRepository.findById(userId);
        if (!user) return { ok: false, reason: 'not-found' };
        const visibility = await userSettingsRepository.getFavoritesVisibility(user.id);
        const isOwner = viewerId === user.id;
        const isFriend =
            viewerId && needsFriendCheck(visibility, isOwner)
                ? await userFriendRepository.areFriends(viewerId, user.id)
                : false;
        if (!canViewFavorites(visibility, { isOwner, isFriend })) return { ok: false, reason: 'hidden' };
        const { worlds } = await publicFavoritesCache.getOrCreate(user.id, async () =>
            resolveWorlds(await favoriteRepository.list(user.id)),
        );
        return { ok: true, worlds, visibility };
    },
};
