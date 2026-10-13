import { and, count, eq, sql } from 'drizzle-orm';
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
    /**
     * 上限の中で登録する（同じ作品の登録し直しは数えない）。件数の確認と保存を、ユーザーごとのロックを取った 1 つの
     * トランザクションで行う（同時に登録しても上限を超えない）。
     */
    async registerWithinLimit(
        record: ExternalWorkKey & { version: string | null },
        max: number,
    ): Promise<'saved' | 'limit'> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`external_works:${record.userId}`}))`);
            const [existing] = await tx
                .select({ url: externalWorks.url })
                .from(externalWorks)
                .where(keyOf(record))
                .limit(1);
            if (!existing) {
                const [row] = await tx
                    .select({ n: count() })
                    .from(externalWorks)
                    .where(eq(externalWorks.userId, record.userId));
                if ((row?.n ?? 0) >= max) return 'limit';
            }
            const registeredAt = new Date();
            await tx
                .insert(externalWorks)
                .values({ ...record, registeredAt })
                .onConflictDoUpdate({
                    target: [externalWorks.userId, externalWorks.kind, externalWorks.url, externalWorks.name],
                    set: { version: record.version, registeredAt },
                });
            return 'saved';
        });
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
