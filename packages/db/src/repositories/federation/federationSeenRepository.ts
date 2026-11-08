import { and, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { db } from '../../index';
import { federationSeen } from '../../schema';

/** 受けた activity の id・RPC の (keyid, nonce) を覚える。2 度目は何もしない・断る。 */
export const federationSeenRepository = {
    /** 初めてなら覚えて true。期限内に覚えていれば false（期限の過ぎた記録は覚え直す）。 */
    async remember(key: string, expiresAt: Date, now: Date): Promise<boolean> {
        const rows = await db
            .insert(federationSeen)
            .values({ key, expiresAt })
            .onConflictDoUpdate({
                target: federationSeen.key,
                set: { expiresAt },
                setWhere: lte(federationSeen.expiresAt, now),
            })
            .returning({ key: federationSeen.key });
        return rows.length > 0;
    },

    /** 期限内に覚えているか（覚えはしない）。 */
    async has(key: string, now: Date): Promise<boolean> {
        const [row] = await db
            .select({ key: federationSeen.key })
            .from(federationSeen)
            .where(and(eq(federationSeen.key, key), gt(federationSeen.expiresAt, now)));
        return !!row;
    },

    /** 忘れる（処理に失敗したとき、相手の送り直しを受けられるように）。 */
    async forget(key: string): Promise<void> {
        await db.delete(federationSeen).where(eq(federationSeen.key, key));
    },

    async deleteExpired(now: Date): Promise<number> {
        const rows = await db
            .delete(federationSeen)
            .where(lt(federationSeen.expiresAt, now))
            .returning({ key: federationSeen.key });
        return rows.length;
    },

    /** テスト・管理用: 覚えている数。 */
    async count(): Promise<number> {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(federationSeen);
        return row?.n ?? 0;
    },
};
