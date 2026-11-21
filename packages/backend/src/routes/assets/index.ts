import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { worldAssetService } from '../../services/worldAssets/worldAssetService';
import { createAssetsRouter } from './router';

export const router = createAssetsRouter({
    requireAuth,
    uploadLimiter: perUserLimiter(
        'world-assets',
        10 * 60 * 1000,
        60,
        '画像のアップロードが多すぎます。少し待ってから試してください',
    ),
    assets: worldAssetService,
});
