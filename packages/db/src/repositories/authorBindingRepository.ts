import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { authorBindings, authorConfirmedContents } from '../schema';

export type AuthorBindingRecord = typeof authorBindings.$inferSelect;

export const authorBindingRepository = {
    async find(account: string): Promise<AuthorBindingRecord | undefined> {
        const results = await db.select().from(authorBindings).where(eq(authorBindings.account, account));
        return results[0];
    },

    /** 取り直した鍵一覧と表示名で置き換える。 */
    async save(account: string, keys: AuthorBindingRecord['keys'], displayName: string | undefined): Promise<void> {
        const fetchedAt = new Date();
        await db
            .insert(authorBindings)
            .values({ account, keys, displayName, fetchedAt })
            .onConflictDoUpdate({ target: authorBindings.account, set: { keys, displayName, fetchedAt } });
    },

    /** 作者付きと確かめた内容を記録する（確認が古くなった間に作者を付けてよい内容）。 */
    async recordConfirmedContent(account: string, contentHash: string): Promise<void> {
        await db.insert(authorConfirmedContents).values({ account, contentHash }).onConflictDoNothing();
    },

    async hasConfirmedContent(account: string, contentHash: string): Promise<boolean> {
        const rows = await db
            .select({ account: authorConfirmedContents.account })
            .from(authorConfirmedContents)
            .where(
                and(eq(authorConfirmedContents.account, account), eq(authorConfirmedContents.contentHash, contentHash)),
            )
            .limit(1);
        return rows.length > 0;
    },
};
