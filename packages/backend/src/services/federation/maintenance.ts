/**
 * 連合の掃除（10 分ごと）とドメインの方針の変更の後片付け。
 * - 届かなかった承認・解除・取り消しを、相手のホームに関係を確かめて埋め合わせる（確かめていないもの・1 日たったものから）
 * - block したドメイン・消えた actor との関係を消し直す（ほかの backend が古い方針のまま受けた申請や、
 *   消えた知らせと行き違って書かれた関係が残らないように）
 * - 期限の切れた記録を消す
 */
import {
    domainPolicyRepository,
    federationSeenRepository,
    followerRepository,
    remoteFriendshipRepository,
    remoteVisitRepository,
} from '@ubichill/db';
import { FEDERATION_FEATURES, FEDERATION_LIMITS } from '@ubichill/shared';
import { logger } from '../../utils/logger';
import { notificationService } from '../notifications/notificationService';
import type { FederationIdentity } from './identity';
import type { ActorDirectory } from './transport/actors';
import type { FriendshipCheck } from './ubichill/friendshipCheck';
import type { RemoteFriendships } from './ubichill/friendships';

/** 消したほかのサーバーの人とのフレンドを、このサーバーの人に知らせる（失敗しても残りは知らせる）。 */
export async function notifyFriendshipsRemoved(
    rows: ReadonlyArray<{ userId: string; actorId: string }>,
): Promise<void> {
    await Promise.all(
        rows.map((r) =>
            notificationService
                .remoteFriendshipRemoved(r.userId, r.actorId)
                .catch((error: unknown) => logger.warn('通知の片付けに失敗:', error)),
        ),
    );
}

/** 消したフォローのうち承認待ちだったものの知らせを片付ける。 */
export async function notifyFollowsRemoved(
    rows: ReadonlyArray<{ userId: string; actorId: string; state: string }>,
): Promise<void> {
    await Promise.all(
        rows
            .filter((r) => r.state === 'pending')
            .map((r) =>
                notificationService
                    .fediverseFollowSettled(r.userId, r.actorId)
                    .catch((error: unknown) => logger.warn('通知の片付けに失敗:', error)),
            ),
    );
}

/** block にしたドメインの人とのフレンドとフォローを切る。 */
export async function severDomain(domain: string): Promise<void> {
    await notifyFriendshipsRemoved(await remoteFriendshipRepository.removeForDomain(domain));
    await notifyFollowsRemoved(await followerRepository.removeForDomain(domain));
}

export function createFederationMaintenance(deps: {
    identity: FederationIdentity;
    actors: ActorDirectory;
    friendships: RemoteFriendships;
    friendshipCheck: FriendshipCheck;
    lacks(domain: string, feature: string): Promise<boolean>;
    log(message: string): void;
}) {
    /** つながらなければ確かめたことにしない（次の掃除でまた試す）。 */
    const recheckFriendships = async (at: Date) => {
        const due = await remoteFriendshipRepository.dueForCheck(
            new Date(at.getTime() - FEDERATION_LIMITS.FRIENDSHIP_RECHECK_MS),
            FEDERATION_LIMITS.FRIENDSHIP_RECHECK_BATCH,
        );
        for (const row of due) {
            const actor = await deps.actors.get(row.actorId).catch(() => null);
            if (!actor || actor.deletedAt) continue;
            if (await deps.lacks(actor.domain, FEDERATION_FEATURES.friends)) {
                await remoteFriendshipRepository.markChecked(row.userId, row.actorId, at);
                continue;
            }
            const peer = await deps.friendshipCheck.relationOf(row.actorId, deps.identity.actorUrl(row.userId));
            if (!peer) continue;
            const result = await deps.friendships.reconcile(row.userId, actor, peer);
            if (result !== 'kept')
                deps.log(`フレンドの関係を相手とそろえました（${result}）: ${row.userId} ⇔ ${row.actorId}`);
            await remoteFriendshipRepository.markChecked(row.userId, row.actorId, at);
        }
    };

    return {
        async sweep(at = new Date()) {
            const blocked = (await domainPolicyRepository.list()).filter((p) => p.policy === 'block');
            const removed = [
                ...(await remoteFriendshipRepository.removeForDeletedActors()),
                ...(await Promise.all(blocked.map((p) => remoteFriendshipRepository.removeForDomain(p.domain)))).flat(),
            ];
            await notifyFriendshipsRemoved(removed);
            await notifyFollowsRemoved([
                ...(await followerRepository.removeForDeletedActors()),
                ...(await Promise.all(blocked.map((p) => followerRepository.removeForDomain(p.domain)))).flat(),
            ]);
            await recheckFriendships(at).catch((error: unknown) =>
                deps.log(`フレンドの関係を確かめられません: ${String(error)}`),
            );
            await Promise.all([
                federationSeenRepository.deleteExpired(at),
                remoteVisitRepository.deleteStale(new Date(at.getTime() - FEDERATION_LIMITS.VISIT_STALE_MS)),
                remoteFriendshipRepository.deleteStale(
                    new Date(at.getTime() - FEDERATION_LIMITS.FRIEND_REQUEST_EXPIRE_MS),
                    new Date(at.getTime() - FEDERATION_LIMITS.REJECT_COOLDOWN_MS),
                ),
            ]);
        },
    };
}
