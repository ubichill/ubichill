import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index';
import { userFavorites } from '../schema';

/**
 * ユーザーのお気に入りワールド。ワールドは worldRef（正規 URL）で参照する
 * （official/外部ワールドは DB に無いため id ではなく URL をキーにする）。
 */
export const favoriteRepository = {
    /** ユーザーのお気に入り worldRef 一覧（新しく追加した順）。 */
    async list(userId: string): Promise<string[]> {
        const rows = await db
            .select({ worldRef: userFavorites.worldRef })
            .from(userFavorites)
            .where(eq(userFavorites.userId, userId))
            .orderBy(desc(userFavorites.createdAt));
        return rows.map((r) => r.worldRef);
    },

    /** 新しく追加した順の limit 件（追加した時刻つき。フェディバースの固定ノート）。 */
    async latest(userId: string, limit: number): Promise<Array<{ worldRef: string; createdAt: Date }>> {
        return db
            .select({ worldRef: userFavorites.worldRef, createdAt: userFavorites.createdAt })
            .from(userFavorites)
            .where(eq(userFavorites.userId, userId))
            .orderBy(desc(userFavorites.createdAt))
            .limit(limit);
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
