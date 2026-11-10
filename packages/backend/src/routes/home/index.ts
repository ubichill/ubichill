import { userSettingsRepository } from '@ubichill/db';
import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { createHomeService } from '../../services/instances/homeInstance';
import { instanceManager } from '../../services/instances/instanceManager';
import { worldRegistry } from '../../services/worlds/worldRegistry';
import { createHomeRouter } from './router';

export const router = createHomeRouter({
    requireAuth,
    writeLimiter: perUserLimiter('home-write', 60 * 1000, 20, 'ホームの変更が多すぎます。少し待ってから試してください'),
    ensureLimiter: perUserLimiter(
        'home-instance',
        60 * 1000,
        10,
        'ホームへの移動が多すぎます。少し待ってから試してください',
    ),
    home: createHomeService({
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
    }),
});
