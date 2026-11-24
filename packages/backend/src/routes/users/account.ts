/**
 * 自分のアカウント（`/api/v1/users/me` の下）: 自分のプロフィール・管理者か・パスワード・表示名・ほかのログインの無効化。
 */
import { DISPLAY_NAME_CHANGE_COOLDOWN_DAYS, OFFICIAL_HANDLE } from '@ubichill/shared';
import { Router } from 'express';
import { auth } from '../../lib/auth';
import { sharedLimiter } from '../../lib/rateLimit';
import {
    requireAuth,
    requireFreshAuth,
    requirePublisher,
    requireRecentAuth,
    requireStrongSession,
    sessionFactsOf,
    toWebHeaders,
} from '../../middleware/auth';
import { accountSessionService } from '../../services/auth/accountSessions';
import { emailLinkService } from '../../services/auth/emailLinkService';
import { loginMethodService } from '../../services/auth/loginMethods';
import { canActAsAdmin } from '../../services/auth/sessionAssurance';
import { publishingEnvironmentService } from '../../services/authors/publishingEnvironmentService';
import { roleService } from '../../services/roles/roleService';
import { accountDeletionService } from '../../services/users/accountDeletionService';
import { changeDisplayName, displayNameAvailableAtOf } from '../../services/users/displayName';
import { publicProfileOf } from '../../services/users/publicProfile';
import { userService } from '../../services/users/userService';

export const router = Router();

router.get('/me', requirePublisher, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = await userService.profileById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [profile, isAdminUser, signingKeys] = await Promise.all([
        publicProfileOf(user),
        roleService.isAdmin(user.id),
        publishingEnvironmentService.activePublicKeysOf(user.id),
    ]);
    // API トークン（CLI）にはセッションが無いので、管理者の権限は使えない
    const isAdmin = !!req.session && canActAsAdmin(isAdminUser, req.session);
    return res.json({
        // 公開プロフィールと同じ項目（プロフィールの編集の元にする）
        ...profile,
        // 取り消されていない公開環境の鍵（このブラウザの鍵が登録済みかの判定に使う）
        signingKeys,
        // 移行時に他人と表示名が重複していた（一意キー未設定）。変更を促す。
        displayNameConflict: !user.displayNameKey,
        // 次に別の名前へ変えられる時刻（変えたことが無ければ null）。見た目だけの変更はいつでもできる
        displayNameChangeAvailableAt: displayNameAvailableAtOf(user.displayNameChangedAt),
        // 公開済みの開発用既定パスワードのまま（公式アカウント）。Secret の設定を促す。
        passwordChangeRequired: user.passwordChangeRequired,
        // パスワードを Secret で管理している（画面から変更できない）
        passwordManagedBySecret: user.handle === OFFICIAL_HANDLE,
        isAdmin,
        // 管理者だが、このセッションは外部の SSO だけで入った（パスワードでログインか再認証をすると管理者の操作ができる）
        adminRequiresPassword: isAdminUser && !isAdmin,
        // API トークン（CLI・CI）で呼んだときの公開環境（ubichill whoami で表示する）
        ...(req.publishingEnvironment
            ? { publishingEnvironment: { id: req.publishingEnvironment.id, kind: req.publishingEnvironment.kind } }
            : {}),
    });
});

// 管理者かどうかだけ（画面が 1 分ごとに確かめる。/me は重いので分ける）。このセッションで管理者の権限を使えるか
router.get('/me/admin', requireAuth, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    const isAdminUser = await roleService.isAdmin(req.user.id);
    if (!isAdminUser) return res.json({ isAdmin: false, adminRequiresPassword: false });
    // クッキーキャッシュは再認証の前の値のことがある。管理者だけ DB のセッションで確かめ直す
    const fresh = canActAsAdmin(true, req.session)
        ? req.session
        : await auth.api
              .getSession({ headers: toWebHeaders(req), query: { disableCookieCache: true } })
              .then((s) => (s ? sessionFactsOf(s.session) : null))
              .catch(() => null);
    const isAdmin = !!fresh && canActAsAdmin(true, fresh);
    return res.json({ isAdmin, adminRequiresPassword: !isAdmin });
});

const reauthLimiter = sharedLimiter(
    'reauthenticate',
    15 * 60 * 1000,
    10,
    '本人確認の試行が多すぎます。しばらくしてから再試行してください。',
    { keyGenerator: (req) => req.user?.id ?? '' },
);

// パスワードで本人確認をし直す（ログイン方法の変更・管理者の操作の前に）。このセッションに確かめた時刻を記録する
router.post('/me/reauthenticate', requireFreshAuth, reauthLimiter, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) return res.status(400).json({ error: 'パスワードを入力してください' });
    if (!(await userService.hasPassword(req.user.id))) {
        return res.status(400).json({ error: 'このアカウントにはパスワードがありません。ログインし直してください' });
    }
    const verified = await auth.api
        .verifyPassword({ body: { password }, headers: toWebHeaders(req) })
        .then((r) => r.status === true)
        .catch(() => false);
    if (!verified) return res.status(400).json({ error: 'パスワードが正しくありません' });
    await loginMethodService.markPasswordVerified(req.user.id, req.session.id, new Date());
    return res.status(204).send();
});

// パスワードを変更する。現在のパスワードの確認は better-auth に任せ、他の端末のセッションは無効にする。
router.put('/me/password', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (await userService.isOfficialAccount(req.user.id)) {
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
    await userService.passwordChanged(req.user.id);
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

// ログイン方法（メールアドレスとパスワード・追加したフェディバースのアカウント・今の設定で使えるか）
router.get('/me/login-methods', requireFreshAuth, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(await loginMethodService.of(req.user.id, req.session, new Date()));
});

// フェディバースのアカウントを外す（直近の本人確認。奪った古いセッションで本人のログイン手段を外させない）。
// 流れは services/auth/loginMethods.ts
router.delete('/me/login-methods/:id', requireRecentAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await loginMethodService.unlink(req.user.id, String(req.params.id), req.session?.id ?? null);
    switch (outcome.status) {
        case 'unlinked':
            return res.status(204).send();
        case 'not-found':
            return res.status(404).json({ error: 'ログイン方法が見つかりません' });
        case 'last-method':
            return res.status(409).json({ error: 'ほかにログインする方法が無いため外せません' });
    }
});

const emailLinkLimiter = sharedLimiter(
    'email-link',
    15 * 60 * 1000,
    5,
    'メールの送信が多すぎます。しばらくしてからお試しください',
    { keyGenerator: (req) => req.user?.id ?? '' },
);
const emailLinkVerifyLimiter = sharedLimiter(
    'email-link-verify',
    15 * 60 * 1000,
    20,
    '試行が多すぎます。しばらくしてからお試しください',
    { keyGenerator: (req) => req.user?.id ?? '' },
);

// メールアドレスを足す（メールなしで登録した人）。アドレスとパスワードを受け取り、確認コードを送る。流れは services/auth/emailLinks.ts
// パスワードというログイン手段を足すので直近の本人確認を求める（奪った古いセッションで攻撃者のパスワードを足し、
// それで本人確認を済ませたことにして CLI の承認などへ進ませない）
router.post('/me/email', requireRecentAuth, emailLinkLimiter, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await emailLinkService.start({
        userId: req.user.id,
        session: req.session,
        email: req.body?.email,
        password: req.body?.password,
    });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ status: outcome.status });
});

// 届いた確認コードで、メールアドレスとパスワードをログイン方法に足す
router.post('/me/email/verify', requireRecentAuth, emailLinkVerifyLimiter, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await emailLinkService.verify({
        userId: req.user.id,
        session: req.session,
        code: req.body?.code,
    });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).send();
});

const deleteLimiter = sharedLimiter(
    'delete-account',
    15 * 60 * 1000,
    5,
    '試行が多すぎます。しばらくしてからお試しください',
    {
        keyGenerator: (req) => req.user?.id ?? '',
    },
);

// アカウントを削除する（退会）。直近の本人確認と、ID の入れ直しが要る。流れは services/users/deleteAccount.ts
router.delete('/me', requireRecentAuth, deleteLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const outcome = await accountDeletionService.deleteAccount(req.user.id, req.body?.handle);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.status(204).send();
});

// ログイン中の端末（期限内のセッション。トークンは返さない）。流れは services/auth/accountSessions.ts
router.get('/me/sessions', requireFreshAuth, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json({ sessions: await accountSessionService.list(req.user.id, req.session.id, new Date()) });
});

// ほかの端末を 1 つログアウトする（すべてのログアウトと同じく、パスワードを持つ人は SSO だけのログインからはできない）
router.delete('/me/sessions/:id', requireStrongSession, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    switch (await accountSessionService.revoke(req.user.id, String(req.params.id), req.session.id)) {
        case 'revoked':
            return res.status(204).send();
        case 'not-found':
            return res.status(404).json({ error: 'その端末は見つかりません（もうログアウトしています）' });
        case 'current':
            return res.status(400).json({ error: 'この端末は、メニューからログアウトしてください' });
    }
});

// いま使っているもの以外のログインをすべて無効にする（乗っ取りに気付いたとき。公開環境の取り消しだけでは攻撃者のログインは残る）
router.post('/me/sessions/revoke-others', requireStrongSession, async (req, res) => {
    if (!req.user || !req.session) return res.status(401).json({ error: 'Unauthorized' });
    const revoked = await userService.revokeOtherSessions(req.user.id, req.session.id);
    return res.json({ revoked });
});
