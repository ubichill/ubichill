import { MESSAGE_LIMITS, REACTION_LIMITS } from '@ubichill/shared';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { messageService } from '../services/social/messageService';
import { logger } from '../utils/logger';
import { createMessagesRouter } from './messages';

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

const SEND_TOO_MANY = 'メッセージを送りすぎています。少し待ってから送ってください';

export const router = createMessagesRouter({
    requireAuth,
    sendLimiters: [
        perUser('messages-send-minute', 60 * 1000, MESSAGE_LIMITS.SEND_PER_MINUTE, SEND_TOO_MANY),
        perUser('messages-send-hour', 60 * 60 * 1000, MESSAGE_LIMITS.SEND_PER_HOUR, SEND_TOO_MANY),
    ],
    reactLimiters: [
        perUser(
            'messages-react-minute',
            60 * 1000,
            REACTION_LIMITS.PER_MINUTE,
            'リアクションを付けすぎています。少し待ってください',
        ),
    ],
    messages: messageService,
});
