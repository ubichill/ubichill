/** ブロックの実体（DB・フレンド・招待・通知・連合をつなぐ）。規則は blocks.ts と shared の social/blocks.ts。 */
import {
    followerRepository,
    inviteRepository,
    remoteFriendshipRepository,
    userBlockRepository,
    userFriendRepository,
} from '@ubichill/db';
import { isRemoteUserId } from '@ubichill/shared';
import { selfAccount } from '../../authors/authorKeys';
import { federation } from '../../federation';
import { notificationService } from '../../notifications/notificationService';
import { summariesOf } from '../userSummaries';
import { createBlockService } from './blocks';

/**
 * ほかのサーバーの人との関係を消す。相手の文書が引ければフレンドの解除・フォロワーから外すことを相手にも知らせ、
 * 引けなければこちらの記録だけ消す。
 */
async function severRemote(userId: string, actorId: string): Promise<void> {
    const actor = federation ? await federation.actors.get(actorId).catch(() => null) : null;
    if (federation && actor) {
        await federation.friendships.remove(userId, actor);
        await federation.follows.reject(userId, actor);
        return;
    }
    await remoteFriendshipRepository.remove(userId, actorId);
    await followerRepository.locked(userId, actorId, async (row, write) => {
        if (row) await write.remove();
    });
}

export const blockService = createBlockService({
    store: userBlockRepository,
    async sever(blockerId, blockedId) {
        if (isRemoteUserId(blockedId)) await severRemote(blockerId, blockedId);
        else await userFriendRepository.remove(blockerId, blockedId);
        await inviteRepository.removeBetween(blockerId, blockedId);
        // フレンド・招待の通知も含めて、2 人の間の通知はすべてここで消える
        await notificationService.blocked(blockerId, blockedId);
    },
    summariesOf,
    accountOf: selfAccount,
    now: () => new Date(),
});
