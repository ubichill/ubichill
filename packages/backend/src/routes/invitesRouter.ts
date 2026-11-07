import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { inviteService } from '../services/social/inviteService';
import { summariesOf } from '../services/social/userSummaries';
import { logger } from '../utils/logger';
import { createInvitesRouter } from './invites';

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

export const router = createInvitesRouter({
    requireAuth,
    inviteLimiter: perUser('invites-send', 60 * 1000, 30, '招待を送りすぎています。少し待ってから送ってください'),
    requestLimiter: perUser('invite-requests', 60 * 1000, 20, 'リクエストが多すぎます。少し待ってから試してください'),
    invites: inviteService,
    summariesOf,
});
