import { randomInt } from 'node:crypto';
import { accounts, db, sessions, users, verifications } from '@ubichill/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// 仮登録データを保持（メモリ内、本番ではRedisなどを使用）
interface PendingRegistration {
    email: string;
    password: string;
    username: string;
    otp: string;
    expiresAt: number;
}
export const pendingRegistrations = new Map<string, PendingRegistration>();

// OTPを生成（暗号学的に安全な乱数を使用）
export function generateOTP(): string {
    return randomInt(100000, 1000000).toString();
}

// 環境変数でメール確認を無効化できるようにする
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';

// 仮登録を作成してOTPを送信
export async function createPendingRegistration(
    email: string,
    password: string,
    username: string,
): Promise<{ success: boolean; error?: string; skipVerification?: boolean }> {
    // 既存ユーザーチェック
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });
    if (existingUser) {
        return { success: false, error: 'このメールアドレスは既に登録されています' };
    }

    // ユーザー名の重複チェック
    const existingUsername = await db.query.users.findFirst({
        where: eq(users.username, username),
    });
    if (existingUsername) {
        return { success: false, error: 'このユーザー名は既に使用されています' };
    }

    // メール確認をスキップする場合は直接登録
    if (SKIP_EMAIL_VERIFICATION) {
        console.log(`⚠️ メール確認をスキップして直接登録: ${email}`);
        try {
            const result = await auth.api.signUpEmail({
                body: {
                    email,
                    password,
                    name: username,
                },
            });

            if (!result) {
                return { success: false, error: '登録に失敗しました' };
            }

            // メール確認済みに設定
            await db.update(users).set({ emailVerified: true, username }).where(eq(users.email, email));

            console.log(`✅ ユーザー登録完了（メール確認スキップ）: ${email}`);
            return { success: true, skipVerification: true };
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: '登録に失敗しました' };
        }
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10分

    // 既存の仮登録を削除（同じメールアドレスで再登録可能に）
    pendingRegistrations.delete(email);

    pendingRegistrations.set(email, {
        email,
        password,
        username,
        otp,
        expiresAt,
    });

    // OTPをメールで送信
    console.log(`📧 OTP送信: ${email}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`   OTP: ${otp}`);
    } else {
        // 本番環境ではOTPの値をログに出さない（セキュリティリスク）
        console.log('   OTP: [REDACTED]');
    }
    try {
        const result = await resend.emails.send({
            from: 'Ubichill <noreply@youkan.uk>',
            to: email,
            subject: `【Ubichill】${username} さんの認証コード`,
            text: `${username} さん、Ubichill へようこそ！

あなたの認証コード:

${otp}

このコードは10分間有効です。

---
このメールは ${email} 宛に送信されました。
心当たりがない場合は、このメールを無視してください。`,
        });
        console.log(`   ✅ OTP送信成功:`, result);
        return { success: true };
    } catch (error) {
        console.error(`   ❌ OTP送信失敗:`, error);
        pendingRegistrations.delete(email);
        return { success: false, error: 'メールの送信に失敗しました' };
    }
}

// OTPを検証して本登録
export async function verifyAndRegister(email: string, otp: string): Promise<{ success: boolean; error?: string }> {
    const pending = pendingRegistrations.get(email);

    if (!pending) {
        return { success: false, error: '仮登録が見つかりません。もう一度登録してください。' };
    }

    if (Date.now() > pending.expiresAt) {
        pendingRegistrations.delete(email);
        return { success: false, error: '認証コードの有効期限が切れました。もう一度登録してください。' };
    }

    if (pending.otp !== otp) {
        return { success: false, error: '認証コードが正しくありません' };
    }

    // 本登録実行
    try {
        const result = await auth.api.signUpEmail({
            body: {
                email: pending.email,
                password: pending.password,
                name: pending.username,
            },
        });

        if (!result) {
            return { success: false, error: '登録に失敗しました' };
        }

        // メール確認済みに設定
        await db.update(users).set({ emailVerified: true, username: pending.username }).where(eq(users.email, email));

        pendingRegistrations.delete(email);
        console.log(`✅ ユーザー登録完了: ${email}`);
        return { success: true };
    } catch (error) {
        console.error('Registration error:', error);
        return { success: false, error: '登録に失敗しました' };
    }
}

// OTPを再送信
export async function resendOTP(email: string): Promise<{ success: boolean; error?: string }> {
    const pending = pendingRegistrations.get(email);

    if (!pending) {
        return { success: false, error: '仮登録が見つかりません。もう一度登録してください。' };
    }

    const otp = generateOTP();
    pending.otp = otp;
    pending.expiresAt = Date.now() + 10 * 60 * 1000;

    console.log(`📧 OTP再送信: ${email}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`   OTP: ${otp}`);
    } else {
        // 本番環境ではOTPの値をログに出さない（セキュリティリスク）
        console.log('   OTP: [REDACTED]');
    }
    try {
        await resend.emails.send({
            from: 'Ubichill <noreply@youkan.uk>',
            to: email,
            subject: `【Ubichill】${pending.username} さんの認証コード（再送信）`,
            text: `${pending.username} さん

新しい認証コード:

${otp}

このコードは10分間有効です。

---
このメールは ${email} 宛に送信されました。
心当たりがない場合は、このメールを無視してください。`,
        });
        return { success: true };
    } catch (error) {
        console.error(`   ❌ OTP再送信失敗:`, error);
        return { success: false, error: 'メールの送信に失敗しました' };
    }
}

// デバッグ: 起動時に設定を確認
console.log('🔐 Better Auth 初期化中...');
console.log(`   RESEND_API_KEY: ${process.env.RESEND_API_KEY ? '設定済み' : '❌ 未設定'}`);
console.log(`   BETTER_AUTH_URL: ${process.env.BETTER_AUTH_URL || 'http://localhost:3001'}`);
console.log(`   CORS_ORIGIN: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
console.log(`   SKIP_EMAIL_VERIFICATION: ${SKIP_EMAIL_VERIFICATION ? '✅ 有効（メール確認スキップ）' : '無効'}`);

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema: {
            user: users,
            session: sessions,
            account: accounts,
            verification: verifications,
        },
    }),
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
    trustedOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim()),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false, // カスタムOTPフローで確認するので無効化
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
        cookieCache: {
            enabled: true,
            maxAge: 60 * 5, // 5 minutes
        },
    },
    user: {
        additionalFields: {
            username: {
                type: 'string',
                required: false,
            },
            profileImageUrl: {
                type: 'string',
                required: false,
            },
        },
    },
});

export type Session = typeof auth.$Infer.Session;
