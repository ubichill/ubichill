import type { ModFavoriteRef } from '@ubichill/shared';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { userModFavorites } from '../schema';

const keyOf = (userId: string, ref: ModFavoriteRef) =>
    and(
        eq(userModFavorites.userId, userId),
        eq(userModFavorites.author, ref.author),
        eq(userModFavorites.modId, ref.id),
    );

export type AddModFavoriteOutcome = 'added' | 'exists' | 'limit';

/** ユーザーのお気に入りの mod（作者と ID）。 */
export const modFavoriteRepository = {
    /** 新しく足した順。 */
    async list(userId: string): Promise<ModFavoriteRef[]> {
        return db
            .select({ author: userModFavorites.author, id: userModFavorites.modId })
            .from(userModFavorites)
            .where(eq(userModFavorites.userId, userId))
            .orderBy(desc(userModFavorites.createdAt), userModFavorites.author, userModFavorites.modId);
    },

    /**
     * 上限の中で足す（もうあれば数えずに exists）。件数の確認と保存を、ユーザーごとのロックを取った 1 つのトランザクションで行う
     * （同時に足しても上限を超えない）。
     */
    async addWithinLimit(userId: string, ref: ModFavoriteRef, max: number): Promise<AddModFavoriteOutcome> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`user_mod_favorites:${userId}`}, 0))`);
            const [existing] = await tx
                .select({ userId: userModFavorites.userId })
                .from(userModFavorites)
                .where(keyOf(userId, ref))
                .limit(1);
            if (existing) return 'exists';
            const [row] = await tx
                .select({ n: count() })
                .from(userModFavorites)
                .where(eq(userModFavorites.userId, userId));
            if ((row?.n ?? 0) >= max) return 'limit';
            await tx.insert(userModFavorites).values({ userId, author: ref.author, modId: ref.id });
            return 'added';
        });
    },

    async remove(userId: string, ref: ModFavoriteRef): Promise<void> {
        await db.delete(userModFavorites).where(keyOf(userId, ref));
    },
};
