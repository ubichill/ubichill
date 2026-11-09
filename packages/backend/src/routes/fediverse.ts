/**
 * フェディバース（Mastodon・Misskey など）とのつながりの設定と、フォロワーの管理（`/api/v1/fediverse`）。
 * - `GET /`: アカウント・設定・承認待ち・フォロワー
 * - `PUT /settings`: 承認制・検索に出すか（承認制をやめたら承認待ちをまとめて承認する）
 * - `POST /followers/approve`・`POST /followers/reject`: 承認待ちを承認する・断る（フォロワーから外すのも reject）
 */
import { type FollowerWithActor, followerRepository, userRepository, userSettingsRepository } from '@ubichill/db';
import {
    FEDIVERSE_LIMITS,
    type FediverseFollower,
    type FediverseOverview,
    FediverseSettingsUpdateSchema,
    FollowerActionSchema,
} from '@ubichill/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { selfAccount } from '../services/authors/authorKeys';
import { federation } from '../services/federation';
import { logger } from '../utils/logger';

const router = Router();

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    message: { error: '操作が多すぎます。少し待ってから試してください' },
    ...sharedRateLimit('fediverse-write', redis, logger),
});

const followerOf = (row: FollowerWithActor): FediverseFollower => ({
    actorId: row.actorId,
    account: row.account,
    name: row.name,
    icon: row.icon,
    url: row.url,
    state: row.state,
    since: row.updatedAt.toISOString(),
});

async function overviewOf(userId: string): Promise<FediverseOverview | null> {
    const user = await userRepository.findById(userId);
    if (!user) return null;
    const [settings, pending, followers, followerCount] = await Promise.all([
        userSettingsRepository.getFediverse(userId),
        followerRepository.listForUser(userId, 'pending', FEDIVERSE_LIMITS.FOLLOWERS_PAGE),
        followerRepository.listForUser(userId, 'accepted', FEDIVERSE_LIMITS.FOLLOWERS_PAGE),
        followerRepository.countAccepted(userId),
    ]);
    return {
        enabled: federation !== null,
        account: selfAccount(user.handle),
        settings,
        pending: pending.map(followerOf),
        followers: followers.map(followerOf),
        followerCount,
    };
}

router.get('/', requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
    const overview = await overviewOf(userId);
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
    const settings = federation
        ? await federation.updateFediverseSettings(userId, parsed.data)
        : await userSettingsRepository.updateFediverse(userId, parsed.data);
    res.json(settings);
});

for (const action of ['approve', 'reject'] as const) {
    router.post(`/followers/${action}`, requireAuth, writeLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        if (!federation) return void res.status(404).json({ error: 'このサーバーは連合していません' });
        const parsed = FollowerActionSchema.safeParse(req.body);
        if (!parsed.success) return void res.status(400).json({ error: 'actorId が必要です' });
        const row = await followerRepository.get(userId, parsed.data.actorId);
        const actor = row ? await federation.actors.get(row.actorId) : null;
        if (!row || !actor) return void res.status(404).json({ error: 'フォロワーが見つかりません' });
        const done =
            action === 'approve'
                ? await federation.follows.approve(userId, actor)
                : (await federation.follows.reject(userId, actor)) === 'rejected';
        if (!done) return void res.status(409).json({ error: '承認待ちではありません' });
        res.status(204).end();
    });
}

export { router };
