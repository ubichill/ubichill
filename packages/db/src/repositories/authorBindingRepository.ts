import { eq } from 'drizzle-orm';
import { db } from '../index';
import { authorBindings } from '../schema';

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
};
