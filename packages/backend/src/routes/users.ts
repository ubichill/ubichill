import {
    favoriteRepository,
    publishingEnvironmentRepository,
    userRepository,
    type WorldRecord,
    worldRepository,
} from '@ubichill/db';
import type { WorldDefinition } from '@ubichill/shared';
import {
    DisplayNameSchema,
    displayNameKey,
    HandleSchema,
    isPublishable,
    LIMITS,
    OFFICIAL_HANDLE,
    verifyKeyRegistration,
} from '@ubichill/shared';
import { Router } from 'express';
import { auth, createPendingRegistration, resendOTP, verifyAndRegister } from '../lib/auth';
import { isAdminHandle, optionalAuth, requireAuth, toWebHeaders } from '../middleware/auth';
import { invalidateAuthorKey } from '../services/authorKeyStore';
import { selfAccount } from '../services/authorKeys';
import {
    browserEnvironmentName,
    publishingEnvironmentView,
    registrationOutcome,
} from '../services/publishingEnvironments';
import { nodeWorldCrypto } from '../services/worldCrypto';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

// 仮登録（OTP送信）
router.post('/register', async (req, res) => {
    const { email, password, displayName, handle } = req.body as {
        email?: string;
        password?: string;
        displayName?: string;
        handle?: string;
    };

    if (!email || !password || !displayName || !handle) {
        return res.status(400).json({ error: 'メールアドレス、パスワード、表示名、ID は必須です' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'パスワードは8文字以上で入力してください' });
    }

    const parsedName = DisplayNameSchema.safeParse(displayName);
    if (!parsedName.success) {
        return res.status(400).json({ error: parsedName.error.issues[0]?.message ?? '表示名が不正です' });
    }
    const trimmedName = parsedName.data;
    const parsedHandle = HandleSchema.safeParse(handle.trim());
    if (!parsedHandle.success) {
        return res.status(400).json({ error: parsedHandle.error.issues[0]?.message ?? 'ID が不正です' });
    }

    const result = await createPendingRegistration(email, password, trimmedName, parsedHandle.data);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    // メール確認をスキップした場合
    if (result.skipVerification) {
        return res.json({
            success: true,
            skipVerification: true,
            message: '登録が完了しました。ログインしてください。',
        });
    }

    return res.json({ success: true, message: '認証コードをメールに送信しました' });
});

// OTP検証して本登録
router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'メールアドレスと認証コードは必須です' });
    }

    const result = await verifyAndRegister(email, otp);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, message: '登録が完了しました' });
});

// OTP再送信
router.post('/resend-otp', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'メールアドレスは必須です' });
    }

    const result = await resendOTP(email);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, message: '認証コードを再送信しました' });
});

// 表示名が使えるか（一意。全角半角・大文字小文字・空白の違いは同じ名前として扱う）。
router.get('/check-display-name', optionalAuth, async (req, res) => {
    const parsed = DisplayNameSchema.safeParse(typeof req.query.name === 'string' ? req.query.name : '');
    if (!parsed.success) {
        return res.json({ available: false, error: parsed.error.issues[0]?.message ?? '表示名が不正です' });
    }
    const existing = await userRepository.findByDisplayNameKey(displayNameKey(parsed.data));
    const own = existing && req.user && existing.id === req.user.id;
    return res.json({
        available: !existing || !!own,
        error: existing && !own ? 'この表示名は既に使用されています' : null,
    });
});

// ID（handle）が使えるか。形式・予約語・重複を確認する。
router.get('/check-handle', async (req, res) => {
    const handle = typeof req.query.handle === 'string' ? req.query.handle.trim() : '';
    const parsed = HandleSchema.safeParse(handle);
    if (!parsed.success) {
        return res.json({ available: false, error: parsed.error.issues[0]?.message ?? 'ID が不正です' });
    }
    try {
        const existing = await userRepository.findByHandle(parsed.data);
        return res.json({ available: !existing, error: existing ? 'この ID は既に使用されています' : null });
    } catch (error) {
        console.error('Handle check error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// 自分のプロフィール
router.get('/me', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await userRepository.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
        id: user.id,
        name: user.name,
        handle: user.handle ?? null,
        author: user.handle ? selfAccount(user.handle) : null,
        // 取り消されていない公開環境の鍵（このブラウザの鍵が登録済みかの判定に使う）
        signingKeys: (await publishingEnvironmentRepository.listByUser(user.id))
            .filter((e) => !e.revokedAt)
            .map((e) => e.publicKey),
        // 移行時に他人と表示名が重複していた（一意キー未設定）。変更を促す。
        displayNameConflict: !user.displayNameKey,
        // 公開済みの開発用既定パスワードのまま（公式アカウント）。Secret の設定を促す。
        passwordChangeRequired: user.passwordChangeRequired,
        // パスワードを Secret で管理している（画面から変更できない）
        passwordManagedBySecret: user.handle === OFFICIAL_HANDLE,
        isAdmin: isAdminHandle(user.handle),
        profileImageUrl: user.profileImageUrl ?? user.image ?? null,
    });
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
    if (!result.ok) {
        return res.status(400).json({ error: '現在のパスワードが正しくありません' });
    }
    // 他セッションの無効化で発行し直されたこのセッションのクッキーを引き継ぐ
    for (const cookie of result.headers.getSetCookie()) res.append('Set-Cookie', cookie);
    await userRepository.setPasswordChangeRequired(req.user.id, false);
    return res.status(204).send();
});

// 表示名を変更する（一意）。ID と違い変更できる。
router.put('/me/display-name', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = DisplayNameSchema.safeParse(typeof req.body?.name === 'string' ? req.body.name : '');
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '表示名が不正です' });
    }
    const key = displayNameKey(parsed.data);
    const existing = await userRepository.findByDisplayNameKey(key);
    if (existing && existing.id !== req.user.id) {
        return res.status(409).json({ error: 'この表示名は既に使用されています' });
    }
    try {
        const updated = await userRepository.setDisplayName(req.user.id, parsed.data, key);
        if (!updated) return res.status(404).json({ error: 'User not found' });
        // ワールドの作者名は表示時にアカウントから引くので、キャッシュ済みの解決結果だけ捨てればよい
        if (updated.handle) invalidateAuthorKey(selfAccount(updated.handle));
        worldRegistry.invalidateResolvedWorlds();
        return res.json({ name: updated.name, displayNameConflict: false });
    } catch {
        return res.status(409).json({ error: 'この表示名は既に使用されています' });
    }
});

// ID（handle）を設定する。変更不可なので未設定のときだけ受け付ける（既存ユーザーの移行用）。
router.put('/me/handle', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = HandleSchema.safeParse(typeof req.body?.handle === 'string' ? req.body.handle.trim() : '');
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'ID が不正です' });
    }
    const current = await userRepository.findById(req.user.id);
    if (current?.handle) return res.status(409).json({ error: 'ID は変更できません' });
    if (await userRepository.findByHandle(parsed.data)) {
        return res.status(409).json({ error: 'この ID は既に使用されています' });
    }
    try {
        const updated = await userRepository.setHandleOnce(req.user.id, parsed.data);
        if (!updated) return res.status(409).json({ error: 'ID は変更できません' });
        return res.json({ handle: updated.handle, author: selfAccount(parsed.data) });
    } catch {
        // 一意制約違反（同時に他人が取った）
        return res.status(409).json({ error: 'この ID は既に使用されています' });
    }
});

// 公開環境（署名鍵）の一覧。取り消したものも含む。
router.get('/me/publishing-environments', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await publishingEnvironmentRepository.listByUser(req.user.id);
    return res.json({ environments: rows.map(publishingEnvironmentView) });
});

// このブラウザを公開環境として登録する（ログインできる = 公開できる）。秘密鍵の所有を署名で証明させる。
router.post('/me/publishing-environments', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { publicKey, at, signature } = (req.body ?? {}) as { publicKey?: unknown; at?: unknown; signature?: unknown };
    if (typeof publicKey !== 'string' || typeof at !== 'string' || typeof signature !== 'string') {
        return res.status(400).json({ error: 'publicKey・at・signature が必要です' });
    }
    const verdict = await verifyKeyRegistration(
        { userId: req.user.id, publicKey, at },
        signature,
        Date.now(),
        nodeWorldCrypto,
    );
    if (!verdict.ok) return res.status(422).json({ error: `鍵の所有を確認できません (${verdict.reason})` });

    const existing = await publishingEnvironmentRepository.findByPublicKey(publicKey);
    const outcome = registrationOutcome(existing, req.user.id);
    if (outcome === 'already-registered' && existing) {
        return res.json({ environment: publishingEnvironmentView(existing) });
    }
    if (outcome === 'revoked') {
        return res.status(409).json({ error: 'この鍵は取り消し済みのため使えません', code: 'revoked' });
    }
    if (outcome === 'taken') return res.status(409).json({ error: 'この鍵は登録できません', code: 'taken' });
    try {
        const created = await publishingEnvironmentRepository.create({
            userId: req.user.id,
            kind: 'browser',
            name: browserEnvironmentName(req.get('user-agent')),
            publicKey,
        });
        worldRegistry.invalidateResolvedWorlds();
        return res.status(201).json({ environment: publishingEnvironmentView(created) });
    } catch {
        return res.status(409).json({ error: 'この鍵は登録できません', code: 'taken' });
    }
});

// 公開環境を取り消す。その鍵の署名は、取り消し前のものも含めてすべて作者が付かなくなる。
router.post('/me/publishing-environments/:id/revoke', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const revoked = await publishingEnvironmentRepository.revoke(req.user.id, String(req.params.id));
    if (!revoked) return res.status(404).json({ error: '有効な公開環境が見つかりません' });
    worldRegistry.invalidateResolvedWorlds();
    return res.json({ environment: publishingEnvironmentView(revoked) });
});

// 自分が作成したワールド一覧（編集に使う詳細情報を含む）
router.get('/me/worlds', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const records = await worldRepository.findByAuthorId(req.user.id);
    // 本人には未署名（非公開）も返す。署名状態を見せて署名し直せるようにする。
    const worlds = await Promise.all(
        records.map(async (r: WorldRecord) => {
            const def = r.definition as WorldDefinition;
            return {
                id: r.name,
                displayName: def.spec.displayName,
                description: def.spec.description ?? null,
                thumbnail: def.spec.thumbnail ?? null,
                version: r.version,
                capacity: def.spec.capacity,
                updatedAt: r.updatedAt,
                identity: (await worldRegistry.getWorld(r.name))?.identity,
            };
        }),
    );
    return res.json({
        worlds,
        limit: LIMITS.MAX_WORLDS_PER_USER,
        remaining: Math.max(0, LIMITS.MAX_WORLDS_PER_USER - worlds.length),
    });
});

// お気に入りワールドの worldRef 一覧
router.get('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const worldRefs = await favoriteRepository.list(req.user.id);
    return res.json({ worldRefs });
});

// お気に入りに追加（worldRef＝ワールドの正規 URL）
router.post('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const worldRef = req.body?.worldRef;
    if (typeof worldRef !== 'string' || worldRef.length === 0) {
        return res.status(400).json({ error: 'worldRef は必須です' });
    }
    await favoriteRepository.add(req.user.id, worldRef);
    return res.status(204).send();
});

// お気に入りから削除
router.delete('/me/favorites', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const worldRef = req.body?.worldRef;
    if (typeof worldRef !== 'string' || worldRef.length === 0) {
        return res.status(400).json({ error: 'worldRef は必須です' });
    }
    await favoriteRepository.remove(req.user.id, worldRef);
    return res.status(204).send();
});

// 公開プロフィール（他ユーザー閲覧用）
router.get('/:userId', async (req, res) => {
    const user = await userRepository.findById(req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
        id: user.id,
        name: user.name,
        handle: user.handle ?? null,
        author: user.handle ? selfAccount(user.handle) : null,
        profileImageUrl: user.profileImageUrl ?? user.image ?? null,
    });
});

// 他ユーザーが作成したワールド一覧（公開メタデータのみ。署名検証済みのワールドだけ公開する）
router.get('/:userId/worlds', async (req, res) => {
    const records = await worldRepository.findByAuthorId(req.params.userId);
    const resolved = await Promise.all(records.map((r: WorldRecord) => worldRegistry.getWorld(r.name)));
    const publishable = new Set(resolved.filter((w) => isPublishable(w?.identity)).map((w) => w?.id));
    const worlds = records
        .filter((r: WorldRecord) => publishable.has(r.name))
        .map((r: WorldRecord) => {
            const def = r.definition as WorldDefinition;
            return {
                id: r.name,
                displayName: def.spec.displayName,
                description: def.spec.description ?? null,
                thumbnail: def.spec.thumbnail ?? null,
                version: r.version,
                capacity: def.spec.capacity,
            };
        });
    return res.json({ worlds });
});

export { router };
