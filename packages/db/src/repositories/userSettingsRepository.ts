import {
    DEFAULT_FAVORITES_VISIBILITY,
    DEFAULT_HOME_SETTINGS,
    type FavoritesVisibility,
    type HomeSettings,
} from '@ubichill/shared';
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

    /** ホームの設定。設定の行が無いユーザーは初期値（既定のワールド・招待のみ）。 */
    async getHome(userId: string): Promise<HomeSettings> {
        const rows = await db
            .select({ worldRef: userSettings.homeWorldRef, accessType: userSettings.homeAccessType })
            .from(userSettings)
            .where(eq(userSettings.userId, userId));
        return rows[0] ?? DEFAULT_HOME_SETTINGS;
    },

    /**
     * ホームの設定のうち、渡した項目だけを変える（設定の行が無ければ初期値で作る）。変えた後の設定を返す。
     * 読んでから全体を書き戻すと、同時に変えたほかの項目（ワールドを解決している間の公開範囲など）を戻してしまうため。
     */
    async updateHome(userId: string, changes: Partial<HomeSettings>): Promise<HomeSettings> {
        const now = new Date();
        const set = {
            ...(changes.worldRef !== undefined ? { homeWorldRef: changes.worldRef } : {}),
            ...(changes.accessType !== undefined ? { homeAccessType: changes.accessType } : {}),
        };
        const [row] = await db
            .insert(userSettings)
            .values({
                userId,
                homeWorldRef: DEFAULT_HOME_SETTINGS.worldRef,
                homeAccessType: DEFAULT_HOME_SETTINGS.accessType,
                ...set,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({ target: userSettings.userId, set: { ...set, updatedAt: now } })
            .returning({ worldRef: userSettings.homeWorldRef, accessType: userSettings.homeAccessType });
        if (!row) throw new Error('ホームの設定を保存できません');
        return row;
    },
};
