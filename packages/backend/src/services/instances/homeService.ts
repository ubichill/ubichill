/** ホームの実体（ユーザーの設定・ワールドの解決・インスタンスをつなぐ）。規則と手順は homeInstance.ts。 */
import { userSettingsRepository } from '@ubichill/db';
import { worldRegistry } from '../worlds/worldRegistry';
import { createHomeService } from './homeInstance';
import { instanceManager } from './instanceManager';

export const homeService = createHomeService({
    settings: {
        get: (userId) => userSettingsRepository.getHome(userId),
        update: (userId, changes) => userSettingsRepository.updateHome(userId, changes),
    },
    worlds: {
        resolve: (ref) => worldRegistry.resolveRefDetailed(ref),
        listItemOf: (world) => worldRegistry.listItemOf(world),
    },
    instances: {
        create: (worldRef, accessType, leaderId) =>
            instanceManager.createInstance({ worldId: worldRef, access: { type: accessType } }, leaderId),
    },
});
