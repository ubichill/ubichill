import { eq } from 'drizzle-orm';
import { db } from '../index';
import { authorBindings } from '../schema';

export type AuthorBindingRecord = typeof authorBindings.$inferSelect;

export const authorBindingRepository = {
    async find(account: string): Promise<AuthorBindingRecord | undefined> {
        const results = await db.select().from(authorBindings).where(eq(authorBindings.account, account));
        return results[0];
    },

    /** 確認した結び付けを保存する（鍵が変わっていれば確認し直した結果で上書き）。 */
    async save(account: string, publicKey: string, displayName: string | undefined): Promise<void> {
        const now = new Date();
        await db
            .insert(authorBindings)
            .values({ account, publicKey, displayName, confirmedAt: now, refreshedAt: now })
            .onConflictDoUpdate({
                target: authorBindings.account,
                set: { publicKey, displayName, confirmedAt: now, refreshedAt: now },
            });
    },

    /** 表示名だけを更新する（鍵は同じまま）。 */
    async refreshDisplayName(account: string, displayName: string | undefined): Promise<void> {
        await db
            .update(authorBindings)
            .set({ displayName, refreshedAt: new Date() })
            .where(eq(authorBindings.account, account));
    },
};
