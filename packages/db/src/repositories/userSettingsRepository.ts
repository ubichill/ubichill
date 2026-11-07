import {
    DEFAULT_FAVORITES_VISIBILITY,
    DEFAULT_HOME_SETTINGS,
    type FavoritesVisibility,
    type HomeSettings,
} from '@ubichill/shared';
import { eq, sql } from 'drizzle-orm';
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

    /** ホームの設定を置き換える（設定の行が無ければ作る）。 */
    async setHome(userId: string, home: HomeSettings): Promise<void> {
        const now = new Date();
        const values = { homeWorldRef: home.worldRef, homeAccessType: home.accessType };
        await db
            .insert(userSettings)
            .values({ userId, ...values, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: now } });
    },

    /**
     * ユーザーごとに 1 つずつ実行する（ホームの部屋を同時に 2 つ作らないため）。backend が複数台でも効くよう Postgres の
     * advisory lock を使い、fn が終わるまで持つ。
     */
    async withHomeLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`home:${userId}`}))`);
            return fn();
        });
    },
};
