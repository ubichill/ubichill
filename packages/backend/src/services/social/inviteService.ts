/** 招待とリクエストインバイトの実体（DB・Go の在室・通知をつなぐ）。規則は invites.ts と shared の instanceAccess.ts。 */
import { instanceRepository, inviteRepository } from '@ubichill/db';
import { instanceRuntime } from '../instances/instanceRuntime';
import { notificationService } from '../notifications/notificationService';
import { worldRegistry } from '../worlds/worldRegistry';
import { friendIdsOf } from './friends';
import { createInviteService } from './invites';

export const inviteService = createInviteService({
    rooms: {
        async find(instanceId) {
            const record = await instanceRepository.findById(instanceId);
            return record && { id: record.id, leaderId: record.leaderId, accessType: record.accessType };
        },
        async describe(instanceId) {
            const record = await instanceRepository.findById(instanceId);
            const world = record ? await worldRegistry.getWorldByUrl(record.worldRef) : undefined;
            return world && { name: world.displayName, image: world.thumbnail ?? null };
        },
    },
    presence: () => instanceRuntime.presence(),
    friendIdsOf,
    invites: inviteRepository,
    notify: notificationService,
    now: () => new Date(),
});
