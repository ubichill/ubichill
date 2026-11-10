/**
 * 自分のアカウント（`/api/v1/users/me` の下）: 自分のプロフィール・管理者か・パスワード・表示名・ほかのログインの無効化。
 */
import { authorKeyRepository, userRepository } from '@ubichill/db';
import { DISPLAY_NAME_CHANGE_COOLDOWN_DAYS, OFFICIAL_HANDLE } from '@ubichill/shared';
import { Router } from 'express';
import { auth } from '../../lib/auth';
import { requireAuth, requireFreshAuth, requirePublisher, toWebHeaders } from '../../middleware/auth';
import { roleService } from '../../services/roles/roleService';
import { changeDisplayName, displayNameAvailableAtOf } from '../../services/users/displayName';
import { publicProfileOf } from '../../services/users/publicProfile';

export const router = Router();

router.get('/me', requirePublisher, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = await userRepository.findProfileById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [profile, isAdmin, keys] = await Promise.all([
        publicProfileOf(user),
        roleService.isAdmin(user.id),
        authorKeyRepository.listByUser(user.id),
    ]);
    return res.json({
        // 公開プロフィールと同じ項目（プロフィールの編集の元にする）
        ...profile,
        // 取り消されていない公開環境の鍵（このブラウザの鍵が登録済みかの判定に使う）
        signingKeys: keys.filter((e) => !e.revokedAt).map((e) => e.publicKey),
        // 移行時に他人と表示名が重複していた（一意キー未設定）。変更を促す。
        displayNameConflict: !user.displayNameKey,
        // 次に別の名前へ変えられる時刻（変えたことが無ければ null）。見た目だけの変更はいつでもできる
        displayNameChangeAvailableAt: displayNameAvailableAtOf(user.displayNameChangedAt),
        // 公開済みの開発用既定パスワードのまま（公式アカウント）。Secret の設定を促す。
        passwordChangeRequired: user.passwordChangeRequired,
        // パスワードを Secret で管理している（画面から変更できない）
        passwordManagedBySecret: user.handle === OFFICIAL_HANDLE,
        isAdmin,
        // API トークン（CLI・CI）で呼んだときの公開環境（ubichill whoami で表示する）
        ...(req.publishingEnvironment
            ? { publishingEnvironment: { id: req.publishingEnvironment.id, kind: req.publishingEnvironment.kind } }
            : {}),
    });
});

// 管理者かどうかだけ（画面が 1 分ごとに確かめる。/me は重いので分ける）
router.get('/me/admin', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json({ isAdmin: await roleService.isAdmin(req.user.id) });
});

// パスワードを変更する。現在のパスワードの確認は better-auth に任せ、他の端末のセッションは無効にする。
router.put('/me/password', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = await userRepository.findById(req.user.id);
    if (me?.handle === OFFICIAL_HANDLE) {
        return res.status(403).json({
            error: '公式アカウントのパスワードはサーバーの設定（OFFICIAL_ACCOUNT_PASSWORD）で管理されています',
        });
    }
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ error: '現在のパスワードと新しいパスワードが必要です' });
    }
    if (newPassword.length < 8) return res.status(400).json({ error: '新しいパスワードは8文字以上にしてください' });
    if (newPassword === currentPassword) {
        return res.status(400).json({ error: '新しいパスワードは現在のパスワードと違うものにしてください' });
    }
    const result = await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: toWebHeaders(req),
        asResponse: true,
    });
    if (!result.ok) return res.status(400).json({ error: '現在のパスワードが正しくありません' });
    // 他セッションの無効化で発行し直されたこのセッションのクッキーを引き継ぐ
    for (const cookie of result.headers.getSetCookie()) res.append('Set-Cookie', cookie);
    await userRepository.setPasswordChangeRequired(req.user.id, false);
    return res.status(204).send();
});

// 表示名を変更する（決め方は services/users/displayName.ts）。
router.put('/me/display-name', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await changeDisplayName(req.user.id, typeof req.body?.name === 'string' ? req.body.name : '');
    if (outcome.ok) {
        return res.json({
            name: outcome.name,
            displayNameConflict: false,
            displayNameChangeAvailableAt: outcome.displayNameChangeAvailableAt,
        });
    }
    switch (outcome.reason) {
        case 'invalid':
            return res.status(400).json({ error: outcome.error });
        case 'not-found':
            return res.status(404).json({ error: 'User not found' });
        case 'taken':
            return res.status(409).json({ error: 'この表示名は既に使用されています' });
        case 'cooldown':
            return res.status(429).json({
                error: `表示名を別の名前に変えられるのは ${DISPLAY_NAME_CHANGE_COOLDOWN_DAYS} 日に 1 回までです`,
                availableAt: outcome.availableAt.toISOString(),
            });
    }
});

// いま使っているもの以外のログインをすべて無効にする（乗っ取りに気付いたとき。公開環境の取り消しだけでは攻撃者のログインは残る）
router.post('/me/sessions/revoke-others', requireFreshAuth, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    const revoked = await userRepository.revokeOtherSessions(req.user.id, req.session.id);
    return res.json({ revoked });
});
