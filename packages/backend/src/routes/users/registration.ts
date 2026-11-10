/**
 * 登録（`/api/v1/users` の下）: 仮登録と OTP・表示名と ID が使えるかの確認。流れは lib/auth.ts（better-auth）。
 */
import { userRepository } from '@ubichill/db';
import { DisplayNameSchema, HandleSchema } from '@ubichill/shared';
import { Router } from 'express';
import { createPendingRegistration, resendOTP, verifyAndRegister } from '../../lib/auth';
import { optionalAuth } from '../../middleware/auth';
import { displayNameAvailability } from '../../services/users/displayName';
import { logger } from '../../utils/logger';

export const router = Router();

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
    const parsedHandle = HandleSchema.safeParse(handle.trim());
    if (!parsedHandle.success) {
        return res.status(400).json({ error: parsedHandle.error.issues[0]?.message ?? 'ID が不正です' });
    }
    const result = await createPendingRegistration(email, password, parsedName.data, parsedHandle.data);
    if (!result.success) return res.status(400).json({ error: result.error });
    // メール確認をスキップした場合
    if (result.skipVerification) {
        return res.json({
            success: true,
            skipVerification: true,
            message: '登録が完了しました。ログインしてください。',
        });
    }
    return res.json({
        success: true,
        registrationId: result.registrationId,
        message: '認証コードをメールに送信しました',
    });
});

// OTP検証して本登録
router.post('/verify', async (req, res) => {
    const { registrationId, otp } = req.body as { registrationId?: unknown; otp?: unknown };
    if (typeof registrationId !== 'string' || typeof otp !== 'string' || !registrationId || !otp) {
        return res.status(400).json({ error: '登録の ID と認証コードは必須です' });
    }
    const result = await verifyAndRegister(registrationId, otp);
    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ success: true, message: '登録が完了しました' });
});

// OTP再送信
router.post('/resend-otp', async (req, res) => {
    const { registrationId } = req.body as { registrationId?: unknown };
    if (typeof registrationId !== 'string' || !registrationId) {
        return res.status(400).json({ error: '登録の ID は必須です' });
    }
    const result = await resendOTP(registrationId);
    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ success: true, message: '認証コードを再送信しました' });
});

// 表示名が使えるか（一意。全角半角・大文字小文字・空白の違いは同じ名前として扱う）。
router.get('/check-display-name', optionalAuth, async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    return res.json(await displayNameAvailability(name, req.user?.id));
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
        logger.error('Handle check error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
