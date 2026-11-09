import {
    DEFAULT_FAVORITES_VISIBILITY,
    DEFAULT_FEDIVERSE_SETTINGS,
    DEFAULT_HOME_SETTINGS,
    DEFAULT_PRESENCE_VISIBILITY,
    type FavoritesVisibility,
    type FediverseSettings,
    type HomeSettings,
    type PresenceVisibility,
} from '@ubichill/shared';
import { eq, inArray } from 'drizzle-orm';
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

    /** オンライン状態の見せ方。設定の行が無いユーザーは初期値（いる場所まで）。 */
    async getPresenceVisibility(userId: string): Promise<PresenceVisibility> {
        return (await userSettingsRepository.presenceVisibilityOf([userId])).get(userId) ?? DEFAULT_PRESENCE_VISIBILITY;
    },

    /** 何人分かまとめて（フレンドの現在地）。行が無いユーザーは返さない（呼ぶ側で初期値にする）。 */
    async presenceVisibilityOf(userIds: readonly string[]): Promise<Map<string, PresenceVisibility>> {
        if (userIds.length === 0) return new Map();
        const rows = await db
            .select({ userId: userSettings.userId, visibility: userSettings.presenceVisibility })
            .from(userSettings)
            .where(inArray(userSettings.userId, [...userIds]));
        return new Map(rows.map((r) => [r.userId, r.visibility]));
    },

    async setPresenceVisibility(userId: string, visibility: PresenceVisibility): Promise<void> {
        const now = new Date();
        await db
            .insert(userSettings)
            .values({ userId, presenceVisibility: visibility, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: { presenceVisibility: visibility, updatedAt: now },
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

    /** フェディバースの設定。設定の行が無いユーザーは初期値（承認しない・検索に出す）。 */
    async getFediverse(userId: string): Promise<FediverseSettings> {
        const [row] = await db
            .select({
                manuallyApprovesFollowers: userSettings.fediverseManuallyApprovesFollowers,
                discoverable: userSettings.fediverseDiscoverable,
            })
            .from(userSettings)
            .where(eq(userSettings.userId, userId));
        return row ?? DEFAULT_FEDIVERSE_SETTINGS;
    },

    /** フェディバースの設定のうち、渡した項目だけを変える（行が無ければ初期値で作る）。変えた後の設定を返す。 */
    async updateFediverse(userId: string, changes: Partial<FediverseSettings>): Promise<FediverseSettings> {
        const now = new Date();
        const set = {
            ...(changes.manuallyApprovesFollowers !== undefined
                ? { fediverseManuallyApprovesFollowers: changes.manuallyApprovesFollowers }
                : {}),
            ...(changes.discoverable !== undefined ? { fediverseDiscoverable: changes.discoverable } : {}),
        };
        const [row] = await db
            .insert(userSettings)
            .values({
                userId,
                fediverseManuallyApprovesFollowers: DEFAULT_FEDIVERSE_SETTINGS.manuallyApprovesFollowers,
                fediverseDiscoverable: DEFAULT_FEDIVERSE_SETTINGS.discoverable,
                ...set,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({ target: userSettings.userId, set: { ...set, updatedAt: now } })
            .returning({
                manuallyApprovesFollowers: userSettings.fediverseManuallyApprovesFollowers,
                discoverable: userSettings.fediverseDiscoverable,
            });
        if (!row) throw new Error('フェディバースの設定を保存できません');
        return row;
    },
};
