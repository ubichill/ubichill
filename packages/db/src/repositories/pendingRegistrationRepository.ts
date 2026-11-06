import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../index';
import { pendingRegistrations } from '../schema';
import { insertCredentialUser, type NewCredentialUser } from './credentialUser';

export type PendingRegistrationRecord = typeof pendingRegistrations.$inferSelect;

/** 同じメールアドレスのロックの中でできること。 */
export interface PendingRegistrationEmailScope {
    countActive(now: Date): Promise<number>;
    insert(record: PendingRegistrationRecord): Promise<void>;
}

/** 行ロックを取った仮登録に対してできること（同じトランザクション）。 */
export interface LockedPendingRegistration {
    remove(): Promise<void>;
    setFailures(failures: number): Promise<void>;
    createCredentialUser(user: NewCredentialUser): Promise<void>;
}

export const pendingRegistrationRepository = {
    /**
     * メールアドレスごとに直列にしてから `fn` を実行する（1 トランザクション）。数えてから足すだけだと、同時の申し込みで
     * 上限を超える。
     */
    async withEmailLock<T>(email: string, fn: (scope: PendingRegistrationEmailScope) => Promise<T>): Promise<T> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(lower(${email}), 0))`);
            return fn({
                countActive: async (now) => {
                    const [row] = await tx
                        .select({ n: count() })
                        .from(pendingRegistrations)
                        .where(and(eq(pendingRegistrations.email, email), gt(pendingRegistrations.expiresAt, now)));
                    return row?.n ?? 0;
                },
                insert: async (record) => {
                    await tx.insert(pendingRegistrations).values(record);
                },
            });
        });
    },

    /**
     * 仮登録の行を `FOR UPDATE` で押さえて `fn` を実行する（1 トランザクション）。`fn` が投げたらロールバックするので、
     * 本登録に失敗しても仮登録は残る。同時に確認されても、後の方は消えた行を見て not-found になる。
     */
    async withLockedRegistration<T>(
        idHash: string,
        fn: (record: PendingRegistrationRecord | undefined, locked: LockedPendingRegistration) => Promise<T>,
    ): Promise<T> {
        return db.transaction(async (tx) => {
            const [record] = await tx
                .select()
                .from(pendingRegistrations)
                .where(eq(pendingRegistrations.idHash, idHash))
                .for('update');
            return fn(record, {
                remove: async () => {
                    await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.idHash, idHash));
                },
                setFailures: async (failures) => {
                    await tx
                        .update(pendingRegistrations)
                        .set({ failures })
                        .where(eq(pendingRegistrations.idHash, idHash));
                },
                createCredentialUser: (user) => insertCredentialUser(tx, user),
            });
        });
    },

    /** 期限内の仮登録のコードを差し替える（失敗回数はそのまま）。期限切れ・無いときは undefined。 */
    async reissue(
        idHash: string,
        otpHash: string,
        expiresAt: Date,
        now: Date,
    ): Promise<Pick<PendingRegistrationRecord, 'email' | 'displayName'> | undefined> {
        const [row] = await db
            .update(pendingRegistrations)
            .set({ otpHash, expiresAt })
            .where(and(eq(pendingRegistrations.idHash, idHash), gt(pendingRegistrations.expiresAt, now)))
            .returning({ email: pendingRegistrations.email, displayName: pendingRegistrations.displayName });
        return row;
    },

    async remove(idHash: string): Promise<void> {
        await db.delete(pendingRegistrations).where(eq(pendingRegistrations.idHash, idHash));
    },

    async deleteExpired(now = new Date()): Promise<void> {
        await db.delete(pendingRegistrations).where(lt(pendingRegistrations.expiresAt, now));
    },
};
