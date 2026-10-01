import { and, eq, or } from 'drizzle-orm';
import { db } from '../index';
import { userFriends } from '../schema';

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
            .where(
                and(
                    eq(userFriends.status, 'accepted'),
                    or(
                        and(eq(userFriends.userId, a), eq(userFriends.friendId, b)),
                        and(eq(userFriends.userId, b), eq(userFriends.friendId, a)),
                    ),
                ),
            )
            .limit(1);
        return rows.length > 0;
    },
};
