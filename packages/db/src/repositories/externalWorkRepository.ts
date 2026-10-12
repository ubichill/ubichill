import { and, count, eq } from 'drizzle-orm';
import { db } from '../index';
import { externalWorks } from '../schema';

export type ExternalWorkRecord = typeof externalWorks.$inferSelect;
export type ExternalWorkKey = Pick<ExternalWorkRecord, 'userId' | 'kind' | 'url' | 'name'>;

const keyOf = (key: ExternalWorkKey) =>
    and(
        eq(externalWorks.userId, key.userId),
        eq(externalWorks.kind, key.kind),
        eq(externalWorks.url, key.url),
        eq(externalWorks.name, key.name),
    );

export const externalWorkRepository = {
    /** 登録する（同じ作品なら版と登録時刻を更新する）。 */
    async upsert(record: ExternalWorkKey & { version: string | null }): Promise<void> {
        const registeredAt = new Date();
        await db
            .insert(externalWorks)
            .values({ ...record, registeredAt })
            .onConflictDoUpdate({
                target: [externalWorks.userId, externalWorks.kind, externalWorks.url, externalWorks.name],
                set: { version: record.version, registeredAt },
            });
    },

    async exists(key: ExternalWorkKey): Promise<boolean> {
        const rows = await db.select({ url: externalWorks.url }).from(externalWorks).where(keyOf(key)).limit(1);
        return rows.length > 0;
    },

    async listByUser(userId: string): Promise<ExternalWorkRecord[]> {
        return db
            .select()
            .from(externalWorks)
            .where(eq(externalWorks.userId, userId))
            .orderBy(externalWorks.registeredAt);
    },

    async countByUser(userId: string): Promise<number> {
        const [row] = await db.select({ n: count() }).from(externalWorks).where(eq(externalWorks.userId, userId));
        return row?.n ?? 0;
    },

    /** 消したら true。 */
    async remove(key: ExternalWorkKey): Promise<boolean> {
        const deleted = await db.delete(externalWorks).where(keyOf(key)).returning({ url: externalWorks.url });
        return deleted.length > 0;
    },
};
