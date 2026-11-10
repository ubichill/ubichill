/**
 * ブロックの有無の読み出し（DB）。規則は shared の user/blocks.ts の interactionRefusal（やり取りを止める共通の前提）。
 * やり取り（フレンド申請・招待・連合・メッセージ・通知）を止めるかの判定はここを使う。ブロックする・解除するのは blockService.ts。
 * 連合・通知の配線からも import するので、ここは DB と shared だけに依存させる（blockService は連合に依存する）。
 */
import { userBlockRepository } from '@ubichill/db';
import {
    isBlockedBetween as blockedIn,
    hiddenIdsOf,
    type InteractionRefusal,
    interactionRefusal,
} from '@ubichill/shared';

/** from が to に何かをしてよいか（自分自身・ブロック）。ID は、このサーバーのユーザー ID か actor の URL。 */
export async function interactionBetween(fromId: string, toId: string): Promise<InteractionRefusal | null> {
    if (fromId === toId) return 'self';
    return interactionRefusal(fromId, toId, await userBlockRepository.findBetween(fromId, toId));
}

/** 2 人のどちらかがもう片方をブロックしているか。 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    return blockedIn(await userBlockRepository.findBetween(a, b), a, b);
}

/** me から見えなくする人（me がブロックした人）。 */
export async function hiddenIdsFor(me: string): Promise<Set<string>> {
    const rows = await userBlockRepository.listForUser(me);
    return hiddenIdsOf(rows, me);
}
