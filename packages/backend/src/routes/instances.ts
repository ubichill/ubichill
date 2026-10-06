import { CreateInstanceRequestSchema, ListInstancesQuerySchema } from '@ubichill/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { instanceManager } from '../services/instanceManager';

const router = Router();

/**
 * GET /api/v1/instances
 * インスタンス一覧を取得（認証必須）
 */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const queryResult = ListInstancesQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            res.status(400).json({ error: 'Invalid query parameters', details: queryResult.error.issues });
            return;
        }

        const instances = await instanceManager.listInstances({
            tag: queryResult.data.tag,
            worldId: queryResult.data.worldId,
            includeFull: queryResult.data.includeFull,
            viewerId: req.user?.id ?? null,
        });

        res.json({ instances });
    } catch (error) {
        console.error('インスタンス一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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
 * 新しいインスタンスを作成（認証必須）
 */
router.post('/', requireAuth, createInstanceLimiter, async (req, res) => {
    try {
        const bodyResult = CreateInstanceRequestSchema.safeParse(req.body);
        if (!bodyResult.success) {
            res.status(400).json({ error: 'Invalid request body', details: bodyResult.error.issues });
            return;
        }

        // 認証されたユーザーIDを使用（requireAuthで保証）
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const leaderId = req.user.id;

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
 * インスタンス詳細を取得（認証必須）
 */
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const id = req.params.id as string;
        // 公開範囲で入れない人には、インスタンスがあることも伏せる
        const instance = await instanceManager.getInstanceFor(id, req.user?.id ?? null);

        if (!instance) {
            res.status(404).json({
                error: 'インスタンスが見つからないか、入れる人が限られています（フレンドのみなど）',
            });
            return;
        }

        res.json(instance);
    } catch (error) {
        console.error('インスタンス取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** SNSの認証・公開範囲を確認し、インスタンスへの接続情報を返す。 */
router.post('/:id/join', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
        return res.json(await instanceManager.join(String(req.params.id), req.user.id, password));
    } catch (error) {
        return res.status(403).json({ error: error instanceof Error ? error.message : '入室できません' });
    }
});

/**
 * DELETE /api/v1/instances/:id
 * インスタンスを終了（認証必須）
 */
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id as string;
        // 認証されたユーザーIDを使用（requireAuthで保証）
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const userId = req.user.id;

        const result = await instanceManager.closeInstance(id, userId);

        if (!result.success) {
            res.status(result.error === 'Instance not found' ? 404 : 403).json({ error: result.error });
            return;
        }

        res.status(204).send();
    } catch (error) {
        console.error('インスタンス削除エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
