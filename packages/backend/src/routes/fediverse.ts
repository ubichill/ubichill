/**
 * フェディバース（Mastodon・Misskey など）とのつながりの設定と、フォロワーの管理（`/api/v1/fediverse`）。
 * - `GET /`: アカウント・設定・承認待ち・フォロワー
 * - `PUT /settings`: 承認制・検索に出すか（承認制をやめたら承認待ちをまとめて承認する）
 * - `POST /followers/approve`・`POST /followers/reject`: 承認待ちを承認する・断る（フォロワーから外すのも reject）
 */
import { FediverseSettingsUpdateSchema, FollowerActionSchema } from '@ubichill/shared';
import { Router } from 'express';
import { perUserLimiter } from '../lib/rateLimit';
import { requireAuth } from '../middleware/auth';
import { fediverseAccountService } from '../services/federation/fediverse/fediverseAccountService';

const router = Router();

const writeLimiter = perUserLimiter('fediverse-write', 60 * 1000, 60, '操作が多すぎます。少し待ってから試してください');

router.get('/', requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
    const overview = await fediverseAccountService.overview(userId);
    if (!overview) return void res.status(404).json({ error: 'User not found' });
    res.set('Cache-Control', 'no-store').json(overview);
});

router.put('/settings', requireAuth, writeLimiter, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
    const parsed = FediverseSettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    }
    res.json(await fediverseAccountService.updateSettings(userId, parsed.data));
});

for (const action of ['approve', 'reject'] as const) {
    router.post(`/followers/${action}`, requireAuth, writeLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        if (!fediverseAccountService.federated) {
            return void res.status(404).json({ error: 'このサーバーは連合していません' });
        }
        const parsed = FollowerActionSchema.safeParse(req.body);
        if (!parsed.success) return void res.status(400).json({ error: 'actorId が必要です' });
        const answer = await fediverseAccountService.answerFollower(userId, parsed.data.actorId, action);
        if (answer === 'not-federated') return void res.status(404).json({ error: 'このサーバーは連合していません' });
        if (answer === 'not-found') return void res.status(404).json({ error: 'フォロワーが見つかりません' });
        if (answer === 'not-pending') return void res.status(409).json({ error: '承認待ちではありません' });
        res.status(204).end();
    });
}

export { router };
