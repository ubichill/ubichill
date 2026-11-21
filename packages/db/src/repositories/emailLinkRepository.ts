import { isPlaceholderEmail } from '@ubichill/shared';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../index';
import { accounts, emailLinkRequests, users } from '../schema';
import { isUniqueViolation } from './pgErrors';

export type EmailLinkRecord = typeof emailLinkRequests.$inferSelect;

export type LinkEmailOutcome = 'linked' | 'email-taken' | 'already-has-email';

/** 行ロックを取った確認待ちに対してできること（同じトランザクション）。 */
export interface LockedEmailLink {
    remove(): Promise<void>;
    setFailures(failures: number): Promise<void>;
    /**
     * ユーザーにメールアドレスとパスワードを足す（users.email を置き換え、credential の accounts を作る）。
     * メールが内部値のまま・パスワードの行が無いユーザーだけ。同じアドレスのユーザーがいれば作らない。
     */
    link(input: { email: string; passwordHash: string; accountId: string; now: Date }): Promise<LinkEmailOutcome>;
}

/** メールアドレスの追加の確認待ち（ユーザーごとに 1 つ）。 */
export const emailLinkRepository = {
    /** 申し込む（同じユーザーの前の申し込みは置き換え、間違えた回数も戻す）。 */
    async put(record: Omit<EmailLinkRecord, 'failures'>): Promise<void> {
        await db
            .insert(emailLinkRequests)
            .values({ ...record, failures: 0 })
            .onConflictDoUpdate({
                target: emailLinkRequests.userId,
                set: {
                    email: record.email,
                    passwordHash: record.passwordHash,
                    otpHash: record.otpHash,
                    failures: 0,
                    expiresAt: record.expiresAt,
                },
            });
    },

    async find(userId: string): Promise<EmailLinkRecord | undefined> {
        const [row] = await db.select().from(emailLinkRequests).where(eq(emailLinkRequests.userId, userId));
        return row;
    },

    /**
     * 確認待ちの行とユーザーの行を `FOR UPDATE` で押さえて `fn` を実行する（1 トランザクション）。同時に確かめても、
     * 後の方は消えた行を見る。
     */
    async withLocked<T>(
        userId: string,
        fn: (record: EmailLinkRecord | undefined, locked: LockedEmailLink) => Promise<T>,
    ): Promise<T> {
        return db.transaction(async (tx) => {
            await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
            const [record] = await tx
                .select()
                .from(emailLinkRequests)
                .where(eq(emailLinkRequests.userId, userId))
                .for('update');
            return fn(record, {
                remove: async () => {
                    await tx.delete(emailLinkRequests).where(eq(emailLinkRequests.userId, userId));
                },
                setFailures: async (failures) => {
                    await tx.update(emailLinkRequests).set({ failures }).where(eq(emailLinkRequests.userId, userId));
                },
                link: async (input) => {
                    const [user] = await tx
                        .select({ email: users.email, emailVerified: users.emailVerified })
                        .from(users)
                        .where(eq(users.id, userId));
                    const [password] = await tx
                        .select({ id: accounts.id })
                        .from(accounts)
                        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
                    if (!user || password || !isPlaceholderEmail(user.email)) return 'already-has-email';
                    try {
                        // 一意制約に当たっても外のトランザクション（確認待ちの削除）は続けられるよう、savepoint の中で書く
                        await tx.transaction(async (sp) => {
                            await sp
                                .update(users)
                                .set({ email: input.email, emailVerified: true, updatedAt: input.now })
                                .where(eq(users.id, userId));
                            await sp.insert(accounts).values({
                                id: input.accountId,
                                accountId: userId,
                                providerId: 'credential',
                                userId,
                                password: input.passwordHash,
                                createdAt: input.now,
                                updatedAt: input.now,
                            });
                        });
                        return 'linked';
                    } catch (error) {
                        if (isUniqueViolation(error)) return 'email-taken';
                        throw error;
                    }
                },
            });
        });
    },

    async deleteExpired(now = new Date()): Promise<void> {
        await db.delete(emailLinkRequests).where(lt(emailLinkRequests.expiresAt, now));
    },
};
