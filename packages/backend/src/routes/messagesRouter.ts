import { MESSAGE_LIMITS } from '@ubichill/shared';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { messageService } from '../services/social/messageService';
import { logger } from '../utils/logger';
import { createMessagesRouter } from './messages';

const perUser = (name: string, windowMs: number, limit: number) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        message: { error: 'メッセージを送りすぎています。少し待ってから送ってください' },
        ...sharedRateLimit(name, redis, logger),
    });

export const router = createMessagesRouter({
    requireAuth,
    sendLimiters: [
        perUser('messages-send-minute', 60 * 1000, MESSAGE_LIMITS.SEND_PER_MINUTE),
        perUser('messages-send-hour', 60 * 60 * 1000, MESSAGE_LIMITS.SEND_PER_HOUR),
    ],
    messages: messageService,
});
