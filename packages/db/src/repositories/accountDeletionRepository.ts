import { eq } from 'drizzle-orm';
import { db } from '../index';
import { instances, retiredAccounts, users } from '../schema';
import { lockHandle } from './handleLock';
import { removeUserRows } from './userRemoval';

export type RetireOutcome =
    /** roomIds: 一緒に消えた、そのユーザーが開いていた部屋（先に閉じた後に作られたもの。Go の部屋を閉じる） */
    { status: 'retired'; handle: string; roomIds: string[] } | { status: 'not-found' };

/** アカウントの削除（退会）と、退会した ID の記録。 */
export const accountDeletionRepository = {
    /**
     * ユーザーを消し、ID とユーザー ID を退会の記録に残す（同じトランザクション）。ユーザーの持ち物（ワールド・部屋・
     * セッション・ログイン方法・プロフィール画像・フレンドなど）は FK の cascade で一緒に消える。
     * ID のロック（{@link lockHandle}）を行のロックより先に取る（作る側と同じ順にする）。ID は変えられないので先に読んでよい。
     */
    async retire(userId: string): Promise<RetireOutcome> {
        return db.transaction(async (tx) => {
            const [found] = await tx.select({ handle: users.handle }).from(users).where(eq(users.id, userId));
            if (!found) return { status: 'not-found' as const };
            await lockHandle(tx, found.handle);
            const [user] = await tx
                .select({ handle: users.handle })
                .from(users)
                .where(eq(users.id, userId))
                .for('update');
            if (!user) return { status: 'not-found' as const };
            // 行を押さえた後は、このユーザーの部屋は新しく作れない（instances.leader_id の FK が待つ）
            const rooms = await tx.select({ id: instances.id }).from(instances).where(eq(instances.leaderId, userId));
            await tx.insert(retiredAccounts).values({ userId, handle: user.handle });
            await removeUserRows(tx, userId);
            return { status: 'retired' as const, handle: user.handle, roomIds: rooms.map((r) => r.id) };
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
