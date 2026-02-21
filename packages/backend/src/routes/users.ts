import { db, users } from '@ubichill/db';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { createPendingRegistration, resendOTP, verifyAndRegister } from '../lib/auth';

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

export default router;
