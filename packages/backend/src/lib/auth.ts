import { randomBytes, randomInt } from 'node:crypto';
import { accounts, db, sessions, users, verifications } from '@ubichill/db';
import { displayNameKey } from '@ubichill/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { Resend } from 'resend';
import { createPendingRegistrationStore } from '../services/pendingRegistrations';

// SKIP_EMAIL_VERIFICATION=true の場合はAPIキー不要なので遅延初期化
let _resend: Resend | null = null;
function getResend(): Resend {
    if (!_resend) {
        _resend = new Resend(process.env.RESEND_API_KEY);
    }
    return _resend;
}

// 認証メールの送信元。組織固有ドメインを直書きせず env で差し替え可能にする
// （OSS としてセルフホスト時に自分の検証済みドメインを使えるように）。
const MAIL_FROM = process.env.MAIL_FROM ?? 'Ubichill <onboarding@resend.dev>';

/**
 * アカウントの安全に関わる通知（新しい公開環境の追加など）をメールで送る。乗っ取りに本人が気付けるようにするため。
 * メールを送らない環境（SKIP_EMAIL_VERIFICATION・API キー未設定）ではログだけ出す。送信の失敗で操作は止めない。
 */
export async function sendAccountNotice(to: string, subject: string, text: string): Promise<void> {
    if (process.env.SKIP_EMAIL_VERIFICATION === 'true' || !process.env.RESEND_API_KEY) {
        console.log(`📧 通知（送信しない環境）: ${subject}`);
        return;
    }
    try {
        await getResend().emails.send({ from: MAIL_FROM, to, subject: `【Ubichill】${subject}`, text });
    } catch (error) {
        console.error(`❌ 通知メールの送信に失敗しました: ${subject}`, error);
    }
}

// 仮登録（メモリ内。複数レプリカでは共有されない）
const pendingRegistrations = createPendingRegistrationStore({
    now: Date.now,
    newId: () => randomBytes(24).toString('base64url'),
    newOtp: () => generateOTP(),
});

// 期限切れエントリを定期削除（メモリリーク防止）
setInterval(() => pendingRegistrations.sweep(), 60_000).unref();

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
    displayName: string,
    handle: string,
): Promise<{ success: boolean; error?: string; skipVerification?: boolean; registrationId?: string }> {
    // 既存ユーザーチェック
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });
    if (existingUser) {
        return { success: false, error: 'このメールアドレスは既に登録されています' };
    }

    // ID（handle）と表示名はどちらも一意（表示名は全角半角・大文字小文字・空白を同一視）。
    const existingHandle = await db.query.users.findFirst({
        where: eq(users.handle, handle),
    });
    if (existingHandle) {
        return { success: false, error: 'この ID は既に使用されています' };
    }
    const nameKey = displayNameKey(displayName);
    const existingName = await db.query.users.findFirst({
        where: eq(users.displayNameKey, nameKey),
    });
    if (existingName) {
        return { success: false, error: 'この表示名は既に使用されています' };
    }

    // メール確認をスキップする場合は直接登録
    if (SKIP_EMAIL_VERIFICATION) {
        console.log(`⚠️ メール確認をスキップして直接登録: ${email}`);
        try {
            const result = await auth.api.signUpEmail({
                body: {
                    email,
                    password,
                    name: displayName,
                },
            });

            if (!result) {
                return { success: false, error: '登録に失敗しました' };
            }

            // メール確認済みに設定
            await db
                .update(users)
                .set({ emailVerified: true, handle, displayNameKey: nameKey })
                .where(eq(users.email, email));

            console.log(`✅ ユーザー登録完了（メール確認スキップ）: ${email}`);
            return { success: true, skipVerification: true };
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: '登録に失敗しました' };
        }
    }

    const pending = pendingRegistrations.add({ email, password, displayName, handle });
    if ('error' in pending) {
        return {
            success: false,
            error: '確認待ちの登録が多すぎます。届いた認証コードを使うか、10分後にやり直してください',
        };
    }
    const { id: registrationId, otp } = pending;

    // OTPをメールで送信
    console.log(`📧 OTP送信: ${email}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`   OTP: ${otp}`);
    } else {
        // 本番環境ではOTPの値をログに出さない（セキュリティリスク）
        console.log('   OTP: [REDACTED]');
    }
    try {
        const result = await getResend().emails.send({
            from: MAIL_FROM,
            to: email,
            subject: `【Ubichill】${displayName} さんの認証コード`,
            text: `${displayName} さん、Ubichill へようこそ！

あなたの認証コード:

${otp}

このコードは10分間有効です。

---
このメールは ${email} 宛に送信されました。
心当たりがない場合は、このメールを無視してください。`,
        });
        console.log(`   ✅ OTP送信成功:`, result);
        return { success: true, registrationId };
    } catch (error) {
        console.error(`   ❌ OTP送信失敗:`, error);
        pendingRegistrations.remove(registrationId);
        return { success: false, error: 'メールの送信に失敗しました' };
    }
}

const VERIFY_ERRORS = {
    'not-found': '仮登録が見つかりません。もう一度登録してください。',
    expired: '認証コードの有効期限が切れました。もう一度登録してください。',
    'wrong-code': '認証コードが正しくありません',
    'too-many-failures': '認証コードを何度も間違えたため、この登録は無効になりました。もう一度登録してください。',
} as const;

// OTPを検証して本登録。仮登録は申し込んだ本人に返した registrationId で引く。
export async function verifyAndRegister(
    registrationId: string,
    otp: string,
): Promise<{ success: boolean; error?: string }> {
    const outcome = pendingRegistrations.verify(registrationId, otp);
    if (outcome.status !== 'verified') {
        return { success: false, error: VERIFY_ERRORS[outcome.status] };
    }
    const pending = outcome.registration;

    // 本登録実行
    try {
        const result = await auth.api.signUpEmail({
            body: {
                email: pending.email,
                password: pending.password,
                name: pending.displayName,
            },
        });

        if (!result) {
            pendingRegistrations.restore(registrationId, pending, otp);
            return { success: false, error: '登録に失敗しました' };
        }

        // メール確認済みに設定
        await db
            .update(users)
            .set({ emailVerified: true, handle: pending.handle, displayNameKey: displayNameKey(pending.displayName) })
            .where(eq(users.email, pending.email));

        console.log(`✅ ユーザー登録完了: ${pending.email}`);
        return { success: true };
    } catch (error) {
        console.error('Registration error:', error);
        pendingRegistrations.restore(registrationId, pending, otp);
        return { success: false, error: '登録に失敗しました' };
    }
}

// OTPを再送信
export async function resendOTP(registrationId: string): Promise<{ success: boolean; error?: string }> {
    const pending = pendingRegistrations.reissue(registrationId);

    if (!pending) {
        return { success: false, error: '仮登録が見つかりません。もう一度登録してください。' };
    }

    const { email, otp } = pending;

    console.log(`📧 OTP再送信: ${email}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`   OTP: ${otp}`);
    } else {
        // 本番環境ではOTPの値をログに出さない（セキュリティリスク）
        console.log('   OTP: [REDACTED]');
    }
    try {
        await getResend().emails.send({
            from: MAIL_FROM,
            to: email,
            subject: `【Ubichill】${pending.displayName} さんの認証コード（再送信）`,
            text: `${pending.displayName} さん

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
    rateLimit: {
        window: 60,
        max: 100,
    },
    user: {
        // どちらもサーバーだけが書く。input を許すと /update-user から任意の値（外部の画像 URL など）を入れられ、
        // 公開のプロフィール・OGP に出てしまう
        additionalFields: {
            username: {
                type: 'string',
                required: false,
                input: false,
            },
            profileImageUrl: {
                type: 'string',
                required: false,
                input: false,
            },
        },
    },
});

export type Session = typeof auth.$Infer.Session;
