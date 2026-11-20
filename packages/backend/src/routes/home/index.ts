import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { homeService } from '../../services/instances/homeService';
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
    home: homeService,
});
