import type { BlockEdge } from '@ubichill/shared';
import { and, count, desc, eq, or } from 'drizzle-orm';
import { db } from '../index';
import { userBlocks } from '../schema';

export interface BlockRecord {
    blockerId: string;
    blockedId: string;
    createdAt: Date;
}

const between = (a: string, b: string) =>
    or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
    );

/** ユーザーのブロック（片方向の行）。判定は shared の social/blocks.ts、ブロックしたときに関係を消すのは backend。 */
export const userBlockRepository = {
    /** ブロックする。新しくブロックしたら true（すでにブロックしていれば false）。 */
    async add(blockerId: string, blockedId: string, now = new Date()): Promise<boolean> {
        const rows = await db
            .insert(userBlocks)
            .values({ blockerId, blockedId, createdAt: now })
            .onConflictDoNothing()
            .returning({ blockedId: userBlocks.blockedId });
        return rows.length > 0;
    },

    /** ブロックを解除する。解除した（ブロックしていた）か。 */
    async remove(blockerId: string, blockedId: string): Promise<boolean> {
        const rows = await db
            .delete(userBlocks)
            .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
            .returning({ blockedId: userBlocks.blockedId });
        return rows.length > 0;
    },

    /** ブロックした人（新しい順）。 */
    async listForUser(blockerId: string): Promise<BlockRecord[]> {
        return db
            .select()
            .from(userBlocks)
            .where(eq(userBlocks.blockerId, blockerId))
            .orderBy(desc(userBlocks.createdAt), desc(userBlocks.blockedId));
    },

    async countForUser(blockerId: string): Promise<number> {
        const [row] = await db.select({ n: count() }).from(userBlocks).where(eq(userBlocks.blockerId, blockerId));
        return row?.n ?? 0;
    },

    /** 2 人の間の行（向きは問わない）。 */
    async findBetween(a: string, b: string): Promise<BlockEdge[]> {
        return db
            .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
            .from(userBlocks)
            .where(between(a, b));
    },
};
