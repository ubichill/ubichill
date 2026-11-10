/** 自分のお気に入り（`/api/v1/users/me/favorites`）。流れは services/worlds/favoriteService.ts。ほかの人のお気に入りは public.ts。 */
import { FAVORITES_VISIBILITIES, FavoritesVisibilitySchema } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { favoriteService } from '../../services/worlds/favoriteService';

export const router = Router();

// お気に入りワールドの worldRef 一覧
router.get('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ worldRefs: await favoriteService.refs(req.user.id) });
});

// お気に入りのワールド（作者まで確認できたものだけ。取得できないものは unavailable）
router.get('/me/favorites/worlds', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await favoriteService.worlds(req.user.id);
    res.set('Cache-Control', 'no-store');
    return res.json(result);
});

router.post('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await favoriteService.add(req.user.id, req.body?.worldRef);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(201).json({ worldRef: outcome.worldRef });
});

router.delete('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const worldRef = req.body?.worldRef;
    if (typeof worldRef !== 'string' || worldRef.length === 0) {
        return res.status(400).json({ error: 'worldRef は必須です' });
    }
    await favoriteService.remove(req.user.id, worldRef);
    return res.status(204).send();
});

// お気に入りの公開範囲を変更する（private / friends / public）。
router.put('/me/favorites/visibility', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = FavoritesVisibilitySchema.safeParse(req.body?.visibility);
    if (!parsed.success) {
        return res.status(400).json({ error: `visibility は ${FAVORITES_VISIBILITIES.join(' / ')} のいずれかです` });
    }
    await favoriteService.setVisibility(req.user.id, parsed.data);
    return res.json({ visibility: parsed.data });
});
