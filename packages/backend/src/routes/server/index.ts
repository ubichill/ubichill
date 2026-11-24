import { sharedLimiter } from '../../lib/rateLimit';
import { brandingService } from '../../services/server/brandingService';
import { directoryService } from '../../services/server/directoryService';
import { serverInfoService } from '../../services/server/serverInfoService';
import { createServerRouter } from './router';

export const router = createServerRouter({
    overview: () => serverInfoService.overview(),
    image: (variant, hash) => brandingService.image(variant, hash),
    directory: () => directoryService.handles(),
    directoryLimiter: sharedLimiter(
        'server-directory',
        60 * 1000,
        30,
        '問い合わせが多すぎます。少し待ってから試してください',
    ),
});
