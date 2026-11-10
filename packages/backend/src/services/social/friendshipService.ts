/** フレンドの操作の実体（DB・連合・通知をつなぐ）。流れは friendships.ts。 */
import { remoteFriendshipRepository, userFriendRepository, userRepository } from '@ubichill/db';
import { federation } from '../federation';
import { notificationService, notifyInBackground } from '../notifications/notificationService';
import { SYSTEM_USER_ID } from '../users/systemUser';
import { createFriendshipService } from './friendships';
import { people, relations } from './relationService';
import { summariesOf } from './userSummaries';

export const friendshipService = createFriendshipService({
    relations,
    people,
    local: {
        findUser: (id) => userRepository.findById(id),
        listForUser: (userId) => userFriendRepository.listForUser(userId),
        requestOrAccept: (from, to) => userFriendRepository.requestOrAccept(from, to),
        accept: (me, from) => userFriendRepository.accept(me, from),
        remove: (a, b) => userFriendRepository.remove(a, b),
    },
    remote: {
        federation: federation?.friendships ?? null,
        actorOf: async (actorId) => (federation ? federation.actors.get(actorId).catch(() => null) : null),
        listForUser: (userId) => remoteFriendshipRepository.listForUser(userId),
        removeRecord: async (userId, actorId) =>
            (await remoteFriendshipRepository.remove(userId, actorId)) !== undefined,
    },
    summariesOf,
    systemUserId: SYSTEM_USER_ID,
    notify: notificationService,
    background: notifyInBackground,
});
