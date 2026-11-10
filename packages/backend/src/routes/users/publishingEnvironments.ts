/** 公開環境（署名鍵。`/api/v1/users/me/publishing-environments`）。流れは services/authors/publishingEnvironmentService.ts。 */
import { RevokeReasonSchema } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth, requireFreshAuth } from '../../middleware/auth';
import { publishingEnvironmentService } from '../../services/authors/publishingEnvironmentService';

export const router = Router();

// 一覧（取り消したものも含む）
router.get('/me/publishing-environments', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ environments: await publishingEnvironmentService.list(req.user.id) });
});

// このブラウザを公開環境として登録する
router.post('/me/publishing-environments', requireFreshAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { publicKey, at, signature } = (req.body ?? {}) as { publicKey?: unknown; at?: unknown; signature?: unknown };
    if (typeof publicKey !== 'string' || typeof at !== 'string' || typeof signature !== 'string') {
        return res.status(400).json({ error: 'publicKey・at・signature が必要です' });
    }
    const outcome = await publishingEnvironmentService.registerBrowser(
        req.user,
        { publicKey, at, signature },
        req.get('user-agent'),
    );
    if (!outcome.ok) {
        return res
            .status(outcome.status)
            .json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) });
    }
    return res.status(outcome.created ? 201 : 200).json({ environment: outcome.environment });
});

// 取り消す
router.post('/me/publishing-environments/:id/revoke', requireFreshAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const reason = RevokeReasonSchema.safeParse(req.body?.reason);
    if (!reason.success) return res.status(400).json({ error: '取り消す理由（lost / compromised）が必要です' });
    const environment = await publishingEnvironmentService.revoke(req.user.id, String(req.params.id), reason.data);
    if (!environment) return res.status(404).json({ error: '有効な公開環境が見つかりません' });
    return res.json({ environment });
});
