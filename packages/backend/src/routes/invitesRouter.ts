import { perUserLimiter } from '../lib/rateLimit';
import { requireAuth } from '../middleware/auth';
import { inviteService } from '../services/social/inviteService';
import { summariesOf } from '../services/social/userSummaries';
import { createInvitesRouter } from './invites';

export const router = createInvitesRouter({
    requireAuth,
    inviteLimiter: perUserLimiter(
        'invites-send',
        60 * 1000,
        30,
        '招待を送りすぎています。少し待ってから送ってください',
    ),
    requestLimiter: perUserLimiter(
        'invite-requests',
        60 * 1000,
        20,
        'リクエストが多すぎます。少し待ってから試してください',
    ),
    invites: inviteService,
    summariesOf,
});
