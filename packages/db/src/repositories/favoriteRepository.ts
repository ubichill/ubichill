import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { userFavorites } from '../schema';

/**
 * ユーザーのお気に入りワールド。ワールドは worldRef（正規 URL）で参照する
 * （official/外部ワールドは DB に無いため id ではなく URL をキーにする）。
 */
export const favoriteRepository = {
    /** ユーザーのお気に入り worldRef 一覧。 */
    async list(userId: string): Promise<string[]> {
        const rows = await db
            .select({ worldRef: userFavorites.worldRef })
            .from(userFavorites)
            .where(eq(userFavorites.userId, userId));
        return rows.map((r) => r.worldRef);
    },

    /** 追加（冪等: 既にあれば何もしない）。 */
    async add(userId: string, worldRef: string): Promise<void> {
        await db.insert(userFavorites).values({ userId, worldRef }).onConflictDoNothing();
    },

    /** 削除。 */
    async remove(userId: string, worldRef: string): Promise<void> {
        await db
            .delete(userFavorites)
            .where(and(eq(userFavorites.userId, userId), eq(userFavorites.worldRef, worldRef)));
    },
};
