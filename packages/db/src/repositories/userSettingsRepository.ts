import { DEFAULT_FAVORITES_VISIBILITY, type FavoritesVisibility } from '@ubichill/shared';
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { userSettings } from '../schema';

export const userSettingsRepository = {
    /** お気に入り一覧の公開範囲。設定の行が無いユーザーは初期値（private）。 */
    async getFavoritesVisibility(userId: string): Promise<FavoritesVisibility> {
        const rows = await db
            .select({ visibility: userSettings.favoritesVisibility })
            .from(userSettings)
            .where(eq(userSettings.userId, userId));
        return rows[0]?.visibility ?? DEFAULT_FAVORITES_VISIBILITY;
    },

    /** 公開範囲を設定する（設定の行が無ければ作る）。 */
    async setFavoritesVisibility(userId: string, visibility: FavoritesVisibility): Promise<void> {
        const now = new Date();
        await db
            .insert(userSettings)
            .values({ userId, favoritesVisibility: visibility, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: { favoritesVisibility: visibility, updatedAt: now },
            });
    },
};
