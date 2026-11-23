import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { roomPortalGrants } from '../../services/instances/roomPortalGrantService';
import { createRoomPortalsRouter } from './router';

export const router = createRoomPortalsRouter({
    requireAuth,
    // ポータルを置き直せるのは 3 秒に 1 回（インスタンスが断る）なので、それより少し緩い
    limiter: perUserLimiter(
        'room-portal-grant',
        60 * 1000,
        30,
        'ポータルを置く操作が多すぎます。少し待ってから試してください',
    ),
    grants: roomPortalGrants,
});
