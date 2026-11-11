import { canAdvanceModVersion } from '@ubichill/shared';
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../index';
import { externalWorks, users } from '../schema';

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
    /** 配布物・全リリースは保存しない。検索はこのサーバーの登録済み作品だけを上限付きで読む。 */
    async modPage(query: string, offset: number, userId?: string) {
        return db
            .select({ work: externalWorks, handle: users.handle })
            .from(externalWorks)
            .innerJoin(users, eq(users.id, externalWorks.userId))
            .where(
                and(
                    eq(externalWorks.kind, 'mod'),
                    ilike(externalWorks.name, `${query.replace(/[\\%_]/g, '\\$&')}%`),
                    userId ? eq(externalWorks.userId, userId) : undefined,
                ),
            )
            .orderBy(externalWorks.userId, externalWorks.name, externalWorks.url)
            .limit(20)
            .offset(Math.min(10000, Math.max(0, offset)));
    },
    async modByName(userId: string, name: string) {
        const [record] = await db
            .select()
            .from(externalWorks)
            .where(and(eq(externalWorks.userId, userId), eq(externalWorks.kind, 'mod'), eq(externalWorks.name, name)))
            .orderBy(desc(externalWorks.registeredAt))
            .limit(1);
        return record;
    },
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
            const registrationKey =
                record.kind === 'mod'
                    ? and(
                          eq(externalWorks.userId, record.userId),
                          eq(externalWorks.kind, 'mod'),
                          eq(externalWorks.name, record.name),
                      )
                    : keyOf(record);
            const [existing] = await tx
                .select({ url: externalWorks.url, version: externalWorks.version })
                .from(externalWorks)
                .where(registrationKey)
                .limit(1);
            if (!existing) {
                const [row] = await tx
                    .select({ n: count() })
                    .from(externalWorks)
                    .where(eq(externalWorks.userId, record.userId));
                if ((row?.n ?? 0) >= max) return 'limit';
            }
            if (
                record.kind === 'mod' &&
                record.version &&
                !canAdvanceModVersion(existing?.version ?? undefined, record.version)
            )
                return 'saved';
            // mod は作者＋ID ごとの配布先ポインタ 1 件。版の履歴・移設履歴を DB に蓄積しない。
            if (record.kind === 'mod') await tx.delete(externalWorks).where(registrationKey);
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
