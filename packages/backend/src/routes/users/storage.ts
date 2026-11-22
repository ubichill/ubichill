/** 設定の「ストレージ」（`/api/v1/users/me` の下）。1 個ずつ消す `DELETE /api/v1/assets/:hash.webp` も同じ数で制限する。 */
import type { StorageOverview } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { storageService } from '../../services/storage/storageService';
import { storageDeleteLimiter, storageReadLimiter } from '../storageLimiters';

export const router = Router();

router.get('/me/storage', requireAuth, storageReadLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json((await storageService.overview(req.user.id)) satisfies StorageOverview);
});

// 一覧の続き（`?cursor=` は前のページの next）
router.get('/me/storage/files', requireAuth, storageReadLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await storageService.files(req.user.id, req.query.cursor);
    res.set('Cache-Control', 'no-store');
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json(outcome.value);
});

// まとめて消す（本文 `{ files: [{ kind, id }] }`。100 個まで）
router.post('/me/storage/files/delete', requireAuth, storageDeleteLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await storageService.removeFiles(req.user.id, req.body);
    res.set('Cache-Control', 'no-store');
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json(outcome.value);
});

// 使われていない画像を自動で消すか（本文 `{ autoCleanup }`）
router.put('/me/storage/settings', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await storageService.updateSettings(req.user.id, req.body);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json(outcome.value);
});
