/** 関係の集め役と人の引き方の実体（DB・連合・ロールをつなぐ）。集め方は relations.ts、引き方は people.ts。 */
import { followerRepository, remoteFriendshipRepository, userBlockRepository, userRepository } from '@ubichill/db';
import { FEDERATION_FEATURES, isRemoteUserId } from '@ubichill/shared';
import { selfDomain } from '../authors/authorKeys';
import { federation } from '../federation';
import { friendshipViewOf } from '../federation/ubichill/friendships';
import { publicProfileOf } from '../users/publicProfile';
import { SYSTEM_USER_ID } from '../users/systemUser';
import { hiddenIdsFor } from './blocks/blockCheck';
import { friendEdgesOf } from './friends/friends';
import { createPeople } from './people';
import { createRelations } from './relations';
import { remoteSummaryOf, summaryOf } from './userSummaries';

export const relations = createRelations({
    friendEdgesOf,
    remoteFriendshipOf: async (userId, actorId) =>
        friendshipViewOf(await remoteFriendshipRepository.get(userId, actorId)),
    blocksBetween: (a, b) => userBlockRepository.findBetween(a, b),
    followOf: async (userId, actorId) => (await followerRepository.get(userId, actorId))?.state,
    lacksFriends: async (domain) =>
        (await federation?.servers.lacks(domain, FEDERATION_FEATURES.friends).catch(() => false)) ?? false,
    publicProfileOf,
    remoteSummaryOf,
});

export const people = createPeople({
    relations,
    users: userRepository,
    async findRemoteActor(ref) {
        if (!federation) return null;
        return isRemoteUserId(ref) ? federation.actors.get(ref) : federation.actors.byAccount(ref);
    },
    hiddenIdsFor,
    systemUserId: SYSTEM_USER_ID,
    summaryOf: (user) => summaryOf(user),
    remoteSummaryOf,
    selfDomain,
});
