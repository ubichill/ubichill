/**
 * 自分の作品（`/api/v1/users/me` の下）: 作ったワールド（編集用）・外部の作品の登録。ほかの人に見せる一覧は public.ts。
 */
import { userRepository } from '@ubichill/db';
import { ExternalWorkRegistrationSchema } from '@ubichill/shared';
import { Router } from 'express';
import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth, requirePublisher } from '../../middleware/auth';
import { selfAccount } from '../../services/authors/authorKeys';
import { registerExternalWork, removeExternalWork } from '../../services/worlds/externalWorkRegistration';
import { externalWorkStatuses } from '../../services/worlds/externalWorkService';
import { myWorldsOf } from '../../services/worlds/myWorlds';

export const router = Router();

// 自分が作成したワールド一覧（編集に使う詳細情報を含む）
router.get('/me/worlds', requirePublisher, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(await myWorldsOf(req.user));
});

// 外部の作品の登録（`ubichill publish` が署名したときに送る）
router.put('/me/external-works', requirePublisher, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = ExternalWorkRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ error: parsed.error.issues[0]?.message ?? '依頼の形式が違います', code: 'invalid-request' });
    }
    const me = await userRepository.findById(req.user.id);
    if (!me) return res.status(404).json({ error: 'User not found' });
    const outcome = await registerExternalWork(me, parsed.data, req.publishingEnvironment?.publicKey);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    return res.json({ work: outcome.work });
});

// 再確認（公開先を取り直す）は外部への取得を起こすので、利用者ごとに回数を抑える
const recheckLimiter = perUserLimiter(
    'external-works-recheck',
    60 * 1000,
    6,
    '再確認が多すぎます。少し待ってから試してください',
    { skip: (req) => req.query.refresh !== '1' },
);

// 登録した外部の作品（本人の設定画面）。公開先を確かめた状態つきで全部返す。?refresh=1 で確かめ直す
router.get('/me/external-works', requireAuth, recheckLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = await userRepository.findById(req.user.id);
    if (!me) return res.json({ works: [] });
    const works = await externalWorkStatuses(me.id, selfAccount(me.handle), req.query.refresh === '1');
    res.set('Cache-Control', 'private, no-store');
    return res.json({ works });
});

router.delete('/me/external-works', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { kind, url, name } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof kind !== 'string' || typeof url !== 'string' || typeof name !== 'string') {
        return res.status(400).json({ error: 'kind・url・name を指定してください' });
    }
    const removed = await removeExternalWork({ userId: req.user.id, kind, url, name });
    return removed ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
});
