import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../index';
import { twoFactorChallenges, userTwoFactors } from '../schema';

export type TwoFactorRecord = typeof userTwoFactors.$inferSelect;

export type TwoFactorPatch = Partial<
    Pick<
        TwoFactorRecord,
        | 'enabledAt'
        | 'lastUsedStep'
        | 'backupCodeHashes'
        | 'failures'
        | 'lockedUntil'
        | 'settingsFailures'
        | 'settingsLockedUntil'
    >
>;

/** 行ロックを取った二段階認証に対してできること（同じトランザクション）。 */
export interface LockedTwoFactor {
    update(patch: TwoFactorPatch): Promise<void>;
    remove(): Promise<void>;
}

/** 二段階認証の設定（ユーザーごとに 1 つ）。 */
export const twoFactorRepository = {
    async find(userId: string): Promise<TwoFactorRecord | undefined> {
        const [row] = await db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, userId));
        return row;
    },

    /**
     * 設定を始める（秘密鍵を置く）。まだ有効でなければ前の設定の途中を置き換え、有効なら何もしない。
     * 有効かどうかの判定と書き込みを 1 文で行う（同時に有効にされても、有効な鍵を上書きしない）。
     */
    async startSetup(userId: string, secret: string, now: Date): Promise<'started' | 'already-enabled'> {
        const rows = await db
            .insert(userTwoFactors)
            .values({ userId, secret, createdAt: now })
            .onConflictDoUpdate({
                target: userTwoFactors.userId,
                set: {
                    secret,
                    lastUsedStep: null,
                    backupCodeHashes: [],
                    failures: 0,
                    lockedUntil: null,
                    settingsFailures: 0,
                    settingsLockedUntil: null,
                    createdAt: now,
                },
                setWhere: isNull(userTwoFactors.enabledAt),
            })
            .returning({ userId: userTwoFactors.userId });
        return rows.length > 0 ? 'started' : 'already-enabled';
    },

    /**
     * 行を `FOR UPDATE` で押さえて `fn` を実行する（1 トランザクション）。コードの確かめ（同じコードの 2 回目・
     * 間違えた回数・使ったバックアップコード）を同時の要求でも 1 つずつ数える。
     */
    async withLocked<T>(
        userId: string,
        fn: (record: TwoFactorRecord | undefined, locked: LockedTwoFactor) => Promise<T>,
    ): Promise<T> {
        return db.transaction(async (tx) => {
            const [record] = await tx
                .select()
                .from(userTwoFactors)
                .where(eq(userTwoFactors.userId, userId))
                .for('update');
            return fn(record, {
                update: async (patch) => {
                    await tx.update(userTwoFactors).set(patch).where(eq(userTwoFactors.userId, userId));
                },
                remove: async () => {
                    await tx.delete(userTwoFactors).where(eq(userTwoFactors.userId, userId));
                },
            });
        });
    },
};

export type TwoFactorChallengeRecord = typeof twoFactorChallenges.$inferSelect;

/** ログインの途中（二段階目のコードを待っている）。 */
export const twoFactorChallengeRepository = {
    async create(record: Omit<TwoFactorChallengeRecord, 'attempts'>): Promise<void> {
        await db.insert(twoFactorChallenges).values({ ...record, attempts: 0 });
    },

    /**
     * 1 回分の試行を取る（期限内で、回数が残っているときだけ）。コードを確かめる前に数えるので、同時に送っても
     * 回数を超えて試せない。取れなければ undefined。
     */
    async beginAttempt(id: string, now: Date, maxAttempts: number): Promise<TwoFactorChallengeRecord | undefined> {
        const [row] = await db
            .update(twoFactorChallenges)
            .set({ attempts: sql`${twoFactorChallenges.attempts} + 1` })
            .where(
                and(
                    eq(twoFactorChallenges.id, id),
                    gt(twoFactorChallenges.expiresAt, now),
                    lt(twoFactorChallenges.attempts, maxAttempts),
                ),
            )
            .returning();
        return row;
    },

    /** 使い切る（消して返す）。同時に通っても、返るのは 1 つだけ。 */
    async consume(id: string, now: Date): Promise<TwoFactorChallengeRecord | undefined> {
        const [row] = await db
            .delete(twoFactorChallenges)
            .where(and(eq(twoFactorChallenges.id, id), gt(twoFactorChallenges.expiresAt, now)))
            .returning();
        return row;
    },

    async remove(id: string): Promise<void> {
        await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.id, id));
    },

    async deleteExpired(now = new Date()): Promise<void> {
        await db.delete(twoFactorChallenges).where(lt(twoFactorChallenges.expiresAt, now));
    },
};
