import { Router } from 'express';
import { modCatalog } from '../services/mods/catalog';

export const router = Router();
router.get('/', async (req, res) => {
    const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        return res.status(400).json({ error: 'offset が不正です' });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(await modCatalog(typeof req.query.q === 'string' ? req.query.q : '', offset));
});
