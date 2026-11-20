import { eq } from 'drizzle-orm';
import { db } from '../index';
import { retiredAccounts, users } from '../schema';

export type RetireOutcome = { status: 'retired'; handle: string } | { status: 'not-found' };

/** アカウントの削除（退会）と、退会した ID の記録。 */
export const accountDeletionRepository = {
    /**
     * ユーザーを消し、ID とユーザー ID を退会の記録に残す（同じトランザクション）。ユーザーの持ち物（ワールド・部屋・
     * セッション・ログイン方法・プロフィール画像・フレンドなど）は FK の cascade で一緒に消える。
     */
    async retire(userId: string): Promise<RetireOutcome> {
        return db.transaction(async (tx) => {
            const [user] = await tx
                .select({ handle: users.handle })
                .from(users)
                .where(eq(users.id, userId))
                .for('update');
            if (!user) return { status: 'not-found' as const };
            await tx.insert(retiredAccounts).values({ userId, handle: user.handle });
            await tx.delete(users).where(eq(users.id, userId));
            return { status: 'retired' as const, handle: user.handle };
        });
    },

    async isHandleRetired(handle: string): Promise<boolean> {
        const [row] = await db
            .select({ handle: retiredAccounts.handle })
            .from(retiredAccounts)
            .where(eq(retiredAccounts.handle, handle));
        return !!row;
    },

    async isUserRetired(userId: string): Promise<boolean> {
        const [row] = await db
            .select({ userId: retiredAccounts.userId })
            .from(retiredAccounts)
            .where(eq(retiredAccounts.userId, userId));
        return !!row;
    },
};
