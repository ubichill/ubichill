import { db, userRepository, users, worldRepository } from '@ubichill/db';
import type { WorldDefinition } from '@ubichill/shared';
import { LIMITS } from '@ubichill/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { createPendingRegistration, resendOTP, verifyAndRegister } from '../lib/auth';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 仮登録（OTP送信）
router.post('/register', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: 'メールアドレス、パスワード、ユーザー名は必須です' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'パスワードは8文字以上で入力してください' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 1 || trimmedUsername.length > 30) {
        return res.status(400).json({ error: 'ユーザー名は1〜30文字で入力してください' });
    }

    const result = await createPendingRegistration(email, password, trimmedUsername);

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

// ユーザー名の重複チェック
router.get('/check-username', async (req, res) => {
    const { username } = req.query;

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
    }

    // ユーザー名の長さチェック（1-30文字）
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 1 || trimmedUsername.length > 30) {
        return res.status(400).json({
            available: false,
            error: 'ユーザー名は1〜30文字で入力してください',
        });
    }

    try {
        const existingUser = await db.query.users.findFirst({
            where: eq(users.username, trimmedUsername),
        });

        return res.json({
            available: !existingUser,
            error: existingUser ? 'このユーザー名は既に使用されています' : null,
        });
    } catch (error) {
        console.error('Username check error:', error);
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
        username: user.username,
        profileImageUrl: user.profileImageUrl ?? user.image ?? null,
    });
});

// 自分が作成したワールド一覧（編集に使う詳細情報を含む）
router.get('/me/worlds', requireAuth, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const records = await worldRepository.findByAuthorId(req.user.id);
    const worlds = records.map((r) => {
        const def = r.definition as WorldDefinition;
        return {
            id: r.name,
            displayName: def.spec.displayName,
            description: def.spec.description ?? null,
            thumbnail: def.spec.thumbnail ?? null,
            version: r.version,
            capacity: def.spec.capacity,
            updatedAt: r.updatedAt,
        };
    });
    return res.json({
        worlds,
        limit: LIMITS.MAX_WORLDS_PER_USER,
        remaining: Math.max(0, LIMITS.MAX_WORLDS_PER_USER - worlds.length),
    });
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
        username: user.username,
        profileImageUrl: user.profileImageUrl ?? user.image ?? null,
    });
});

// 他ユーザーが作成したワールド一覧（公開メタデータのみ）
router.get('/:userId/worlds', async (req, res) => {
    const records = await worldRepository.findByAuthorId(req.params.userId);
    const worlds = records.map((r) => {
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
