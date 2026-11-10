import { BLOCK_REFUSAL_MESSAGES, BlockRequestSchema, type BlocksResponse } from '@ubichill/shared';
import { type RequestHandler, Router } from 'express';
import type { BlockService } from '../../services/social/blocks/blocks';
import type { People } from '../../services/social/people';
import { logger } from '../../utils/logger';

export interface BlocksRouterDeps {
    requireAuth: RequestHandler;
    /** ほかのサーバーの人のブロック・解除は連合へ送信が出るので、連打で増やさせない */
    limiter: RequestHandler;
    blocks: BlockService;
    people: Pick<People, 'exists'>;
}

/**
 * ブロック（`/api/v1/social` の下）。規則は shared の social/blocks.ts。
 * - `GET /blocks`: ブロックした人（新しい順）
 * - `POST /blocks`: ブロックする（フレンド・申請・招待・通知を消し、ほかのサーバーの人ならフォロワーからも外す）
 * - `DELETE /blocks/:userId`: 解除する（消したフレンドの関係は戻さない）
 */
export function createBlocksRouter(deps: BlocksRouterDeps): Router {
    const router = Router();

    router.get('/blocks', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const blocks = await deps.blocks.list(req.user.id);
        res.set('Cache-Control', 'no-store');
        return res.json({ blocks } satisfies BlocksResponse);
    });

    router.post('/blocks', deps.requireAuth, deps.limiter, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const parsed = BlockRequestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'userId が必要です' });
        if (!(await deps.people.exists(parsed.data.userId))) return res.status(404).json({ error: 'User not found' });
        try {
            const outcome = await deps.blocks.block(req.user.id, parsed.data.userId);
            if (!outcome.ok) return res.status(400).json({ error: BLOCK_REFUSAL_MESSAGES[outcome.reason] });
            return res.status(204).send();
        } catch (error) {
            logger.error('ブロックの後片付けに失敗しました:', error);
            return res
                .status(503)
                .json({ error: 'ブロックしましたが、関係を消しきれませんでした。もう一度ブロックしてください' });
        }
    });

    router.delete('/blocks/:userId', deps.requireAuth, deps.limiter, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (!(await deps.blocks.unblock(req.user.id, String(req.params.userId)))) {
            return res.status(404).json({ error: 'ブロックしていません' });
        }
        return res.status(204).send();
    });

    return router;
}
