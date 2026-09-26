import { favoriteRepository, userRepository, type WorldRecord, worldRepository } from '@ubichill/db';
import type { WorldDefinition } from '@ubichill/shared';
import { HandleSchema, isPublishable, LIMITS, verifyKeyRegistration } from '@ubichill/shared';
import { Router } from 'express';
import { createPendingRegistration, resendOTP, verifyAndRegister } from '../lib/auth';
import { requireAuth } from '../middleware/auth';
import { invalidateAuthorKey, selfAccount } from '../services/authorKeys';
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

    const trimmedName = displayName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 50) {
        return res.status(400).json({ error: '表示名は1〜50文字で入力してください' });
    }
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

// ID（handle）が使えるか。形式・予約語・重複を確認する（表示名は重複してよいので確認しない）。
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
        signingPublicKey: user.signingPublicKey ?? null,
        profileImageUrl: user.profileImageUrl ?? user.image ?? null,
    });
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

// 作者署名の公開鍵を登録・置き換える（1 アカウント 1 本）。秘密鍵の所有を署名で証明させる。
router.put('/me/signing-key', requireAuth, async (req, res) => {
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

    const updated = await userRepository.setSigningPublicKey(req.user.id, publicKey);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    // 作者表示・worldId が変わるので、キャッシュ済みの識別結果を捨てる
    if (updated.handle) invalidateAuthorKey(selfAccount(updated.handle));
    worldRegistry.invalidateIdentities();
    return res.json({ signingPublicKey: updated.signingPublicKey });
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
