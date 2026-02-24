import { CreateInstanceRequestSchema, ListInstancesQuerySchema } from '@ubichill/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { instanceManager } from '../services/instanceManager';

const router = Router();

/**
 * GET /api/v1/instances
 * インスタンス一覧を取得
 */
router.get('/', (req, res) => {
    const queryResult = ListInstancesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: queryResult.error.issues });
        return;
    }

    const instances = instanceManager.listInstances({
        tag: queryResult.data.tag,
        includeFull: queryResult.data.includeFull,
    });

    res.json({ instances });
});

const createInstanceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1時間
    limit: 10, // 1IPあたり10件まで
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many instances created from this IP, please try again after an hour' },
});

/**
 * POST /api/v1/instances
 * 新しいインスタンスを作成
 */
router.post('/', createInstanceLimiter, async (req, res) => {
    try {
        const bodyResult = CreateInstanceRequestSchema.safeParse(req.body);
        if (!bodyResult.success) {
            res.status(400).json({ error: 'Invalid request body', details: bodyResult.error.issues });
            return;
        }

        // TODO: 認証からユーザーIDを取得
        const leaderId = (req.headers['x-user-id'] as string) || 'anonymous';

        const result = await instanceManager.createInstance(bodyResult.data, leaderId);

        if ('error' in result) {
            res.status(400).json({ error: result.error });
            return;
        }

        res.status(201).json(result);
    } catch (error) {
        console.error('インスタンス作成エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/instances/:id
 * インスタンス詳細を取得
 */
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const instance = instanceManager.getInstance(id);

    if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
    }

    res.json(instance);
});

/**
 * DELETE /api/v1/instances/:id
 * インスタンスを終了
 */
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    // TODO: 認証からユーザーIDを取得
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';

    const result = instanceManager.closeInstance(id, userId);

    if (!result.success) {
        res.status(result.error === 'Instance not found' ? 404 : 403).json({ error: result.error });
        return;
    }

    res.status(204).send();
});

export default router;
