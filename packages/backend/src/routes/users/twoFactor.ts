/**
 * 二段階認証の設定（`/api/v1/users/me/two-factor` の下）。規則は services/auth/twoFactor/twoFactor.ts。
 * - 始めるのは直近の本人確認の後だけ（奪われた古いセッションで鍵を登録され、本人が入れなくなるのを防ぐ）。
 * - 無効にする・バックアップコードを作り直すには今のコードが要るので、DB のセッションだけを確かめる。
 *   ここでの間違いはログインを止める回数に数えないので、総当たりはこの口の回数の制限で絞る。
 */
import { Router } from 'express';
import { perUserLimiter } from '../../lib/rateLimit';
import { requireFreshAuth, requireRecentAuth } from '../../middleware/auth';
import { twoFactorService } from '../../services/auth/twoFactor/twoFactorService';

export const router = Router();

const setupLimiter = perUserLimiter(
    'two-factor-setup',
    15 * 60 * 1000,
    20,
    '試行が多すぎます。しばらくしてからお試しください',
);
// 奪われたセッションで、今のコードを総当たりして外させない（1 時間に 5 回。1 か月続けても当たる見込みは 1% ほど）
const codeLimiter = perUserLimiter(
    'two-factor-code',
    60 * 60 * 1000,
    5,
    'コードの入力が多すぎます。1 時間ほどしてからお試しください',
);

router.get('/me/two-factor', requireFreshAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json(await twoFactorService.status(req.user.id));
});

// 認証アプリに登録する鍵を作る（まだ有効にはしない）
router.post('/me/two-factor/setup', requireRecentAuth, setupLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.beginSetup(req.user.id);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});

// 認証アプリのコードで登録を確かめて有効にし、バックアップコードを返す
router.post('/me/two-factor/enable', requireFreshAuth, setupLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.enable(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});

router.post('/me/two-factor/disable', requireFreshAuth, codeLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.disable(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).send();
});

router.post('/me/two-factor/backup-codes', requireFreshAuth, codeLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await twoFactorService.regenerateBackupCodes(req.user.id, req.body?.code);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.set('Cache-Control', 'no-store');
    return res.json(outcome.value);
});
