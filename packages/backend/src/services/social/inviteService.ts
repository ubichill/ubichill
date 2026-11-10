/** 招待とリクエストインバイトの実体（DB・Go の在室・通知・連合をつなぐ）。規則は invites.ts と shared の instanceAccess.ts。 */
import { instanceRepository, inviteRepository, userSettingsRepository } from '@ubichill/db';
import { type Federation, federation } from '../federation';
import { instanceRuntime } from '../instances/instanceRuntime';
import { notificationService } from '../notifications/notificationService';
import { worldRegistry } from '../worlds/worldRegistry';
import { friendIdsOf } from './friends';
import { createInviteService, type InviteFederation } from './invites';

/** 招待の連合の口（ほかのサーバーの部屋は、来訪の記録から部屋の URL を引く）。 */
const inviteFederationOf = (f: Federation): InviteFederation => ({
    isRemoteRoom: (roomRef) => f.remoteAddressOf(roomRef) !== null,
    visitingRoom: (userId) => f.invites.visitingRoom(userId),
    cannotReceiveInvites: (userId) => f.invites.cannotReceiveInvites(userId),
    deliverInvite: (input) => f.invites.deliverInvite(input),
    sendFromRemoteRoom: (inviterId, roomAddress, inviteeIds, message) =>
        f.invites.sendFromRemoteRoom(inviterId, roomAddress, inviteeIds, message),
    requestRemote: (requesterId, targetId) => f.invites.requestRemote(requesterId, targetId),
});

export const inviteService = createInviteService({
    rooms: {
        async find(instanceId) {
            const record = await instanceRepository.findById(instanceId);
            return (
                record && {
                    id: record.id,
                    leaderId: record.leaderId,
                    accessType: record.accessType,
                    maxUsers: record.maxUsers,
                }
            );
        },
        async describe(instanceId) {
            const record = await instanceRepository.findById(instanceId);
            const world = record ? await worldRegistry.getWorldByUrl(record.worldRef) : undefined;
            return world && { name: world.displayName, image: world.thumbnail ?? null };
        },
    },
    presence: () => instanceRuntime.presence(),
    friendIdsOf,
    visibilityOf: (userIds) => userSettingsRepository.presenceVisibilityOf(userIds),
    invites: inviteRepository,
    notify: notificationService,
    federation: federation ? inviteFederationOf(federation) : undefined,
    now: () => new Date(),
});
