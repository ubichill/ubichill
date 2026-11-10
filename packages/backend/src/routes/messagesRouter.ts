import { MESSAGE_LIMITS, REACTION_LIMITS } from '@ubichill/shared';
import { perUserLimiter } from '../lib/rateLimit';
import { requireAuth } from '../middleware/auth';
import { messageService } from '../services/social/messageService';
import { createMessagesRouter } from './messages';

const SEND_TOO_MANY = 'メッセージを送りすぎています。少し待ってから送ってください';

export const router = createMessagesRouter({
    requireAuth,
    sendLimiters: [
        perUserLimiter('messages-send-minute', 60 * 1000, MESSAGE_LIMITS.SEND_PER_MINUTE, SEND_TOO_MANY),
        perUserLimiter('messages-send-hour', 60 * 60 * 1000, MESSAGE_LIMITS.SEND_PER_HOUR, SEND_TOO_MANY),
    ],
    reactLimiters: [
        perUserLimiter(
            'messages-react-minute',
            60 * 1000,
            REACTION_LIMITS.PER_MINUTE,
            'リアクションを付けすぎています。少し待ってください',
        ),
    ],
    messages: messageService,
});
