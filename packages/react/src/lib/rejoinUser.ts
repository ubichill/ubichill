import type { User } from '@ubichill/shared';

/**
 * 参加・参加し直すときに送るユーザー。再接続では、最初に参加したときの値ではなく今の位置・ステータスを送る
 * （送り直した値でサーバーも自分の表示も上書きされるので、古い値だと移動やステータスが巻き戻る）。
 */
export function rejoinUser(initial: Omit<User, 'id'>, current: User | null, now: number): Omit<User, 'id'> {
    if (!current) return initial;
    const { id: _id, ...rest } = current;
    return { ...rest, lastActiveAt: now };
}
