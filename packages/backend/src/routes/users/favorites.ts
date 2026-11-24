/**
 * 自分のお気に入り（`/api/v1/users/me/favorites`）。流れはワールドが services/worlds/favoriteService.ts、
 * mod が services/mods/modFavoriteService.ts。ほかの人のお気に入りは public.ts。
 */
import { FAVORITES_VISIBILITIES, FavoritesVisibilitySchema } from '@ubichill/shared';
import { Router } from 'express';
import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { modFavoriteService } from '../../services/mods/modFavoriteService';
import { favoriteService } from '../../services/worlds/favoriteService';

export const router = Router();

// お気に入りのワールドの worldRef と mod の作者・ID（お気に入り済みの印に使う）
router.get('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const [worldRefs, modRefs] = await Promise.all([
        favoriteService.refs(req.user.id),
        modFavoriteService.refs(req.user.id),
    ]);
    return res.json({ worldRefs, modRefs });
});

// お気に入りのワールド（作者まで確認できたものだけ。取得できないものは unavailable）
router.get('/me/favorites/worlds', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await favoriteService.worlds(req.user.id);
    res.set('Cache-Control', 'no-store');
    return res.json(result);
});

// 追加は外部のワールドの取得を起こすので、利用者ごとに回数を抑える
const addLimiter = perUserLimiter(
    'favorites-add',
    60 * 1000,
    30,
    'お気に入りの追加が多すぎます。少し待ってから試してください',
);

router.post('/me/favorites', requireAuth, addLimiter, async (req, res) => {
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

// お気に入りの mod を作者のカタログで引いた今の版（引けないものは unavailable）
router.get('/me/favorites/mods', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await modFavoriteService.resolved(req.user.id);
    res.set('Cache-Control', 'no-store');
    return res.json(result);
});

// 足すときは作者のカタログ（ほかのサーバーのことも）を引くので、利用者ごとに回数を抑える
const addModLimiter = perUserLimiter(
    'mod-favorites-add',
    60 * 1000,
    30,
    'お気に入りの追加が多すぎます。少し待ってから試してください',
);

router.post('/me/favorites/mods', requireAuth, addModLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await modFavoriteService.add(req.user.id, req.body);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(201).json(outcome.mod);
});

router.delete('/me/favorites/mods', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await modFavoriteService.remove(req.user.id, req.body);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).send();
});

// お気に入りの公開範囲を変更する（private / friends / public）。ワールドと mod で 1 つ
router.put('/me/favorites/visibility', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = FavoritesVisibilitySchema.safeParse(req.body?.visibility);
    if (!parsed.success) {
        return res.status(400).json({ error: `visibility は ${FAVORITES_VISIBILITIES.join(' / ')} のいずれかです` });
    }
    await favoriteService.setVisibility(req.user.id, parsed.data);
    return res.json({ visibility: parsed.data });
});
