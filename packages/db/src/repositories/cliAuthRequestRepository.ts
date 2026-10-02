import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../index';
import { cliAuthRequests } from '../schema';

export type CliAuthRequestRecord = typeof cliAuthRequests.$inferSelect;
export type CreateCliAuthRequestInput = Omit<CliAuthRequestRecord, 'createdAt' | 'userId' | 'authCodeHash' | 'status'>;

export const cliAuthRequestRepository = {
    async create(input: CreateCliAuthRequestInput): Promise<CliAuthRequestRecord> {
        const rows = await db
            .insert(cliAuthRequests)
            .values({ ...input, status: 'pending' })
            .returning();
        return rows[0];
    },

    /** 失効していない要求（失効したものは無いものとして扱う）。 */
    async findActive(id: string, now = new Date()): Promise<CliAuthRequestRecord | undefined> {
        const rows = await db
            .select()
            .from(cliAuthRequests)
            .where(and(eq(cliAuthRequests.id, id), gt(cliAuthRequests.expiresAt, now)));
        return rows[0];
    },

    async findActiveByUserCode(userCode: string, now = new Date()): Promise<CliAuthRequestRecord | undefined> {
        const rows = await db
            .select()
            .from(cliAuthRequests)
            .where(and(eq(cliAuthRequests.userCode, userCode), gt(cliAuthRequests.expiresAt, now)));
        return rows[0];
    },

    /** 承認する（承認待ちのものだけ）。ループバックなら認可コードの hash も保存する。 */
    async approve(id: string, userId: string, authCodeHash: string | null): Promise<CliAuthRequestRecord | undefined> {
        const rows = await db
            .update(cliAuthRequests)
            .set({ status: 'approved', userId, authCodeHash })
            .where(and(eq(cliAuthRequests.id, id), eq(cliAuthRequests.status, 'pending')))
            .returning();
        return rows[0];
    },

    /** 引き換え済みにする（承認済みのものを 1 回だけ）。同時に引き換えられても 1 つしか通らない。 */
    async consume(id: string): Promise<CliAuthRequestRecord | undefined> {
        const rows = await db
            .update(cliAuthRequests)
            .set({ status: 'consumed' })
            .where(and(eq(cliAuthRequests.id, id), eq(cliAuthRequests.status, 'approved')))
            .returning();
        return rows[0];
    },

    /** 失効した要求を消す（起動時・定期）。 */
    async deleteExpired(now = new Date()): Promise<void> {
        await db.delete(cliAuthRequests).where(lt(cliAuthRequests.expiresAt, now));
    },
};
