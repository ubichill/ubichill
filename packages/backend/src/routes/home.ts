import { HomeSettingsUpdateSchema } from '@ubichill/shared';
import { type RequestHandler, type Response, Router } from 'express';
import type { HomeOutcome, HomeService } from '../services/instances/homeInstance';
import { logger } from '../utils/logger';

export interface HomeRouterDeps {
    requireAuth: RequestHandler;
    /** 設定の変更 */
    writeLimiter: RequestHandler;
    /** ホームの部屋の用意（使い回すことが多いので、通常のインスタンス作成の上限とは別に数える） */
    ensureLimiter: RequestHandler;
    home: HomeService;
}

const send = <T>(res: Response, outcome: HomeOutcome<T>): void => {
    if (outcome.ok) res.set('Cache-Control', 'no-store').json(outcome.value);
    else res.status(outcome.status).json({ error: outcome.error });
};

/**
 * ホームワールド（`/api/v1/users` の下）。
 * - `GET /me/home`: 設定とホームのワールド
 * - `PUT /me/home`: ワールド（null で既定に戻す）・公開範囲を変える
 * - `POST /me/home/instance`: ホームの部屋を返す（`?fallback=default` で既定のワールド）
 */
export function createHomeRouter(deps: HomeRouterDeps): Router {
    const router = Router();
    router.get('/me/home', deps.requireAuth, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        res.set('Cache-Control', 'no-store').json(await deps.home.view(userId));
    });

    router.put('/me/home', deps.requireAuth, deps.writeLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const parsed = HomeSettingsUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        }
        send(res, await deps.home.update(userId, parsed.data));
    });

    router.post('/me/home/instance', deps.requireAuth, deps.ensureLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        try {
            send(res, await deps.home.ensureInstance(userId, { useDefault: req.query.fallback === 'default' }));
        } catch (error) {
            logger.error('ホームの部屋の用意に失敗:', error);
            res.status(503).json({ error: 'ホームの部屋を用意できません' });
        }
    });

    return router;
}
