import { and, eq, or } from 'drizzle-orm';
import { db } from '../index';
import { userFriends } from '../schema';

export type FriendRow = typeof userFriends.$inferSelect;

/** a と b の間の行（申請の向きは問わない）。 */
const between = (a: string, b: string) =>
    or(
        and(eq(userFriends.userId, a), eq(userFriends.friendId, b)),
        and(eq(userFriends.userId, b), eq(userFriends.friendId, a)),
    );

/**
 * フレンド関係。1 行は「userId が friendId に申請した」で、承認されると status が accepted になる。
 * 申請の向きは問わずに 2 人の関係を 1 つとして扱う（両方向の行ができても、どちらかが accepted ならフレンド）。
 */
export const userFriendRepository = {
    /**
     * 2 人が承認済みのフレンドか。申請の向きは問わない（A→B の申請を B が承認した行でも、B→A の行でも成立）。
     * 申請中（pending）はフレンドではない。
     */
    async areFriends(a: string, b: string): Promise<boolean> {
        if (a === b) return false;
        const rows = await db
            .select({ userId: userFriends.userId })
            .from(userFriends)
            .where(and(eq(userFriends.status, 'accepted'), between(a, b)))
            .limit(1);
        return rows.length > 0;
    },

    /** ユーザーが関わるすべての行（自分の申請・自分への申請・フレンド）。 */
    async listForUser(userId: string): Promise<FriendRow[]> {
        return db
            .select()
            .from(userFriends)
            .where(or(eq(userFriends.userId, userId), eq(userFriends.friendId, userId)));
    },

    /** 2 人の間の行。 */
    async findBetween(a: string, b: string): Promise<FriendRow[]> {
        return db.select().from(userFriends).where(between(a, b));
    },

    /** 申請する（既に行があれば何もしない）。 */
    async request(from: string, to: string): Promise<void> {
        await db.insert(userFriends).values({ userId: from, friendId: to, status: 'pending' }).onConflictDoNothing();
    },

    /** `from` からの申請を `me` が承認する。承認できた（申請があった）か。 */
    async accept(me: string, from: string): Promise<boolean> {
        const rows = await db
            .update(userFriends)
            .set({ status: 'accepted' })
            .where(and(eq(userFriends.userId, from), eq(userFriends.friendId, me)))
            .returning();
        return rows.length > 0;
    },

    /** 2 人の関係を消す（フレンドの解除・申請の取り消し・拒否）。消えた行があったか。 */
    async remove(a: string, b: string): Promise<boolean> {
        const rows = await db.delete(userFriends).where(between(a, b)).returning();
        return rows.length > 0;
    },
};
