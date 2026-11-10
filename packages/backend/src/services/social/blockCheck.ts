/**
 * ブロックの有無の読み出し（DB）。規則は shared の user/blocks.ts。
 * やり取り（フレンド申請・招待・連合・メッセージなど）を止めるかの判定はここを使う。ブロックする・解除するのは blockService.ts。
 * 連合・通知の配線からも import するので、ここは DB と shared だけに依存させる（blockService は連合に依存する）。
 */
import { userBlockRepository } from '@ubichill/db';
import { isBlockedBetween as blockedIn, hasBlocked, hiddenIdsOf } from '@ubichill/shared';

/** 2 人のどちらかがもう片方をブロックしているか（ID は、このサーバーのユーザー ID か actor の URL）。 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    return blockedIn(await userBlockRepository.findBetween(a, b), a, b);
}

/** me から見えなくする人（me がブロックした人）。 */
export async function hiddenIdsFor(me: string): Promise<Set<string>> {
    const rows = await userBlockRepository.listForUser(me);
    return hiddenIdsOf(rows, me);
}

/** blocker が target をブロックしているか（向きを見る）。 */
export async function hasBlockedUser(blockerId: string, targetId: string): Promise<boolean> {
    if (blockerId === targetId) return false;
    return hasBlocked(await userBlockRepository.findBetween(blockerId, targetId), blockerId, targetId);
}
