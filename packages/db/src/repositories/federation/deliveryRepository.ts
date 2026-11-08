import { count, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../index';
import { federationDeliveries } from '../../schema';
import type { Tx } from '../credentialUser';

export type DeliveryRecord = typeof federationDeliveries.$inferSelect;

/** 送る予定の行（入れる前）。 */
export interface NewDelivery {
    id: string;
    senderUserId: string | null;
    inbox: string;
    host: string;
    body: unknown;
    orderKey: string;
    deadlineAt: Date;
}

/** 送る activity の予定。取り出しは SKIP LOCKED で、backend が何台あっても同じものを 2 度送らない。 */
export const deliveryRepository = {
    /** 送る予定に入れる。q にトランザクションを渡すと、状態の書き込みと一緒に確定する。 */
    async enqueue(input: NewDelivery, now: Date, q: typeof db | Tx = db): Promise<void> {
        await q.insert(federationDeliveries).values({ ...input, nextAttemptAt: now, createdAt: now });
    },

    /**
     * 送る時刻の来たものを limit 件まで取り出し、lockMs の間ほかの backend が取らないようにする。
     * 同じ組（orderKey）は古いものから 1 つずつ（前のものが残っている間は後のものを送らない）。止めているホストは除く。
     */
    async claimDue(input: {
        now: Date;
        limit: number;
        lockMs: number;
        excludedHosts: readonly string[];
    }): Promise<DeliveryRecord[]> {
        const now = input.now.toISOString();
        const lockedUntil = new Date(input.now.getTime() + input.lockMs).toISOString();
        const notExcluded =
            input.excludedHosts.length > 0
                ? sql`AND d.host NOT IN (${sql.join(
                      input.excludedHosts.map((h) => sql`${h}`),
                      sql`, `,
                  )})`
                : sql``;
        const rows = await db.execute<{ id: string }>(sql`
            WITH due AS (
                SELECT d.id FROM ${federationDeliveries} d
                WHERE d.next_attempt_at <= ${now}::timestamptz
                  AND (d.locked_until IS NULL OR d.locked_until < ${now}::timestamptz)
                  ${notExcluded}
                  AND NOT EXISTS (
                      SELECT 1 FROM ${federationDeliveries} e
                      WHERE e.order_key = d.order_key AND (e.created_at, e.id) < (d.created_at, d.id)
                  )
                ORDER BY d.next_attempt_at
                LIMIT ${input.limit}
                FOR UPDATE SKIP LOCKED
            )
            UPDATE ${federationDeliveries} SET locked_until = ${lockedUntil}::timestamptz
            FROM due WHERE ${federationDeliveries.id} = due.id
            RETURNING ${federationDeliveries.id} AS id`);
        const ids = rows.map((r) => r.id);
        if (ids.length === 0) return [];
        const claimed = await db.select().from(federationDeliveries).where(inArray(federationDeliveries.id, ids));
        return claimed.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
    },

    /** 届いた・諦めた（予定から消す）。 */
    async remove(id: string): Promise<void> {
        await db.delete(federationDeliveries).where(eq(federationDeliveries.id, id));
    },

    /** 送り直す（次の時刻と失敗の理由を記録して、ほかの backend も取れるようにする）。 */
    async reschedule(id: string, nextAttemptAt: Date, error: string): Promise<void> {
        await db
            .update(federationDeliveries)
            .set({
                attempts: sql`${federationDeliveries.attempts} + 1`,
                nextAttemptAt,
                lastError: error.slice(0, 500),
                lockedUntil: null,
            })
            .where(eq(federationDeliveries.id, id));
    },

    /** 期限を過ぎたものを諦める。諦めた件数。 */
    async deleteExpired(now: Date): Promise<number> {
        const rows = await db
            .delete(federationDeliveries)
            .where(lt(federationDeliveries.deadlineAt, now))
            .returning({ id: federationDeliveries.id });
        return rows.length;
    },

    async countPending(): Promise<number> {
        const [row] = await db.select({ n: count() }).from(federationDeliveries);
        return row?.n ?? 0;
    },
};
