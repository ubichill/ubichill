/** フレンド関係の読み出し（DB）。規則は shared の friends.ts。ほかのサーバーの人とのフレンドは remote_friendships。 */
import { remoteFriendshipRepository, userFriendRepository } from '@ubichill/db';
import { type FriendEdge, friendGroupsOf, isRemoteUserId } from '@ubichill/shared';

export async function friendEdgesOf(userId: string): Promise<FriendEdge[]> {
    return userFriendRepository.listForUser(userId);
}

/**
 * 承認済みのフレンドの ID。ログインしていなければ空。
 * このサーバーのユーザーなら、このサーバーのフレンドの ID と、ほかのサーバーのフレンドの actor の URL。
 * ほかのサーバーの人（actor の URL）なら、その人とフレンドの、このサーバーのユーザー（部屋の公開範囲の判定に使う）。
 */
export async function friendIdsOf(userId: string | null | undefined): Promise<Set<string>> {
    if (!userId) return new Set();
    if (isRemoteUserId(userId)) return new Set(await remoteFriendshipRepository.acceptedUsersOf(userId));
    const [edges, remote] = await Promise.all([
        friendEdgesOf(userId),
        remoteFriendshipRepository.acceptedActorsOf(userId),
    ]);
    return new Set([...friendGroupsOf(edges, userId).friends, ...remote]);
}
