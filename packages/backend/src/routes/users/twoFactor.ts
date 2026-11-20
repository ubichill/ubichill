/**
 * 二段階認証の設定（`/api/v1/users/me/two-factor` の下）。規則は services/auth/twoFactor/twoFactor.ts。
 * - 始めるのは直近の本人確認の後だけ（奪われた古いセッションで鍵を登録され、本人が入れなくなるのを防ぐ）。
 * - 無効にする・バックアップコードを作り直すには今のコードが要るので、DB のセッションだけを確かめる。
 */
import { Router } from 'express';
import { sharedLimiter } from '../../lib/rateLimit';
import { requireFreshAuth, requireRecentAuth } from '../../middleware/auth';
import { twoFactorService } from '../../services/auth/twoFactor/twoFactorService';

export const router = Router();

const twoFactorLimiter = sharedLimiter(
    'two-factor-settings',
    15 * 60 * 1000,
    20,
    '試行が多すぎます。しばらくしてからお試しください',
    { keyGenerator: (req) => req.user?.id ?? '' },
);

router.get('/me/two-factor', requireFreshAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json(await twoFactorService.status(req.user.id));
});

// 認証アプリに登録する鍵を作る（まだ有効にはしない）
router.post('/me/two-factor/setup', requireRecentAuth, twoFactorLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.beginSetup(req.user.id);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});

// 認証アプリのコードで登録を確かめて有効にし、バックアップコードを返す
router.post('/me/two-factor/enable', requireFreshAuth, twoFactorLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.enable(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});

router.post('/me/two-factor/disable', requireFreshAuth, twoFactorLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.disable(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).send();
});

router.post('/me/two-factor/backup-codes', requireFreshAuth, twoFactorLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.regenerateBackupCodes(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});
