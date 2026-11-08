import { userSettingsRepository } from '@ubichill/db';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { createHomeService } from '../services/homeInstance';
import { instanceManager } from '../services/instanceManager';
import { worldRegistry } from '../services/worldRegistry';
import { logger } from '../utils/logger';
import { createHomeRouter } from './home';

const perUser = (name: string, windowMs: number, limit: number, error: string) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        message: { error },
        ...sharedRateLimit(name, redis, logger),
    });

export const router = createHomeRouter({
    requireAuth,
    writeLimiter: perUser('home-write', 60 * 1000, 20, 'ホームの変更が多すぎます。少し待ってから試してください'),
    ensureLimiter: perUser('home-instance', 60 * 1000, 10, 'ホームへの移動が多すぎます。少し待ってから試してください'),
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
