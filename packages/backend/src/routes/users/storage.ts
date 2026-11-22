/** 設定の「ストレージ」（`/api/v1/users/me` の下）。ワールドの画像を消すのは routes/assets。 */
import type { StorageOverview } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { storageService } from '../../services/storage/storageService';

export const router = Router();

router.get('/me/storage', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json((await storageService.overview(req.user.id)) satisfies StorageOverview);
});

// 使われていない画像を自動で消すか（本文 `{ autoCleanup }`）
router.put('/me/storage/settings', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await storageService.updateSettings(req.user.id, req.body);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json(outcome.value);
});
