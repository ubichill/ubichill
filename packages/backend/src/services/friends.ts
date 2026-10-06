/** フレンド関係の読み出し（DB）。規則は shared の friends.ts。 */
import { userFriendRepository } from '@ubichill/db';
import { type FriendEdge, friendGroupsOf } from '@ubichill/shared';

export async function friendEdgesOf(userId: string): Promise<FriendEdge[]> {
    return userFriendRepository.listForUser(userId);
}

/** 承認済みのフレンドの ID。ログインしていなければ空。 */
export async function friendIdsOf(userId: string | null | undefined): Promise<Set<string>> {
    if (!userId) return new Set();
    return new Set(friendGroupsOf(await friendEdgesOf(userId), userId).friends);
}
