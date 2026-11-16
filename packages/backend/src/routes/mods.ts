import { Router } from 'express';
import { federatedModCatalog, modCatalog } from '../services/mods/catalog';

export const router = Router();
/**
 * GET /api/v1/mods?q=&offset=&scope=local|global
 * local（既定）はこのサーバーの作者の mod。ほかのサーバーと CLI も読むので、どこからでも読める。
 * global はフォロー中のサーバーの mod。このサーバーの画面のための一覧なので、ほかのオリジンには出さない。
 */
router.get('/', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (req.query.scope === 'global') {
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(await federatedModCatalog(query));
    }
    const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        return res.status(400).json({ error: 'offset が不正です' });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(await modCatalog(query, offset));
});
