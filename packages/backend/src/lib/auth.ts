import { randomBytes, randomInt } from 'node:crypto';
import {
    accountDeletionRepository,
    accounts,
    db,
    pendingRegistrationRepository,
    sessions,
    userRepository,
    users,
    verifications,
} from '@ubichill/db';
import { contactEmailOf, displayNameKey, isReservedEmail } from '@ubichill/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { multiSession } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appConfig } from '../config';
import { createProductionFediverseSignIn } from '../services/auth/fediverse';
import { featuredServerList } from '../services/auth/fediverse/featuredServerList';
import { featuredServersFor } from '../services/auth/fediverse/featuredServers';
import type { FediverseSignIn } from '../services/auth/fediverse/signIn';
import {
    createOtpHasher,
    createPendingRegistrations,
    normalizeEmail,
    type PendingRegistrations,
} from '../services/auth/pendingRegistrations';
import { createSignInEmailResolver } from '../services/auth/signInEmail';
import { createProductionTwoFactor, type ProductionTwoFactor } from '../services/auth/twoFactor';
import { logger } from '../utils/logger';
import { accountSwitchPlugin } from './accountSwitchPlugin';
import { createAuthRateLimitStorage } from './authRateLimit';
import { fediverseSignInPlugin } from './fediverseSignInPlugin';
import { createMailer, mailTransportFrom } from './mail';
import { redis } from './redis';
import { registrationSignInPlugin } from './registrationSignInPlugin';
import { sessionAssuranceFields, sessionAssuranceHooks } from './sessionAssuranceOptions';
import { signInIdentifierPlugin } from './signInIdentifierPlugin';
import { type SecondFactorGate, twoFactorPlugin } from './twoFactorPlugin';

// 認証メールの送信元。組織固有ドメインを直書きせず env で差し替え可能にする
// （OSS としてセルフホスト時に自分の検証済みドメインを使えるように）。
const MAIL_FROM = process.env.MAIL_FROM ?? 'Ubichill <onboarding@resend.dev>';

/** メールの送り方（SMTP_URL か RESEND_API_KEY。lib/mail.ts） */
const mailer = createMailer(
    mailTransportFrom({ smtpUrl: appConfig.email.smtpUrl, resendApiKey: appConfig.email.resendApiKey }),
    MAIL_FROM,
);
const sendMail = (input: { to: string; subject: string; text: string }) => mailer.send(input);

/**
 * アカウントの安全に関わる通知（新しい公開環境の追加など）をメールで送る。乗っ取りに本人が気付けるようにするため。
 * 確認済みの連絡先が無いユーザー（フェディバースで登録したメールなしのユーザーなど）には送らない。
 * メールを送らない環境（SKIP_EMAIL_VERIFICATION・送り方が未設定）ではログだけ出す。送信の失敗で操作は止めない。
 */
export async function sendAccountNotice(
    user: { email: string; emailVerified: boolean },
    subject: string,
    text: string,
): Promise<void> {
    const to = contactEmailOf(user);
    if (!to || appConfig.email.skipVerification || !mailer.configured) {
        logger.info(`通知（送信しない環境）: ${subject}`);
        return;
    }
    try {
        await sendMail({ to, subject: `【Ubichill】${subject}`, text });
    } catch (error) {
        logger.error(`通知メールの送信に失敗しました: ${subject}`, error);
    }
}

/** メールアドレスの追加の確認コードを送る（送れなければ投げる）。 */
export async function sendEmailLinkCode(to: string, otp: string): Promise<void> {
    logger.info(`メールアドレスの追加のコード: ${to} OTP=${otpForLog(otp)}`);
    await sendMail({
        to,
        subject: '【Ubichill】メールアドレスの確認コード',
        text: `Ubichill のアカウントにこのメールアドレスを追加するための確認コード:

${otp}

このコードは10分間有効です。

---
心当たりがない場合は、このメールを無視してください。アドレスは追加されません。`,
    });
}

// OTPを生成（暗号学的に安全な乱数を使用）
export function generateOTP(): string {
    return randomInt(100000, 1000000).toString();
}

// 環境変数でメール確認を無効化できるようにする
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';

// 本番環境ではOTPの値をログに出さない（セキュリティリスク）
const otpForLog = (otp: string): string => (process.env.NODE_ENV === 'development' ? otp : '[REDACTED]');

// 仮登録を作成してOTPを送信
export async function createPendingRegistration(
    rawEmail: string,
    password: string,
    displayName: string,
    handle: string,
): Promise<{
    success: boolean;
    error?: string;
    skipVerification?: boolean;
    registrationId?: string;
    /** メール確認を飛ばして本登録したユーザー */
    userId?: string;
}> {
    const email = normalizeEmail(rawEmail);
    // 本登録は signUpEmail を通らないので、signUpEmail がしていた入力の確認をここでする
    if (!appConfig.registrationOpen) {
        return { success: false, error: '現在、新規登録を受け付けていません' };
    }
    if (!z.email().safeParse(email).success || isReservedEmail(email)) {
        return { success: false, error: 'メールアドレスの形式が正しくありません' };
    }
    const ctx = await auth.$context;
    const { minPasswordLength, maxPasswordLength } = ctx.password.config;
    if (password.length < minPasswordLength || password.length > maxPasswordLength) {
        return {
            success: false,
            error: `パスワードは${minPasswordLength}文字以上${maxPasswordLength}文字以下で入力してください`,
        };
    }

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
    if (existingHandle || (await accountDeletionRepository.isHandleRetired(handle))) {
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
        const userId = newBetterAuthId(ctx, 'user');
        try {
            const created = await userRepository.createCredentialUser({
                userId,
                accountId: newBetterAuthId(ctx, 'account'),
                email,
                name: displayName,
                handle,
                displayNameKey: nameKey,
                passwordHash: await ctx.password.hash(password),
                now: new Date(),
            });
            if (created === 'handle-retired') return { success: false, error: 'この ID は既に使用されています' };

            logger.info(`ユーザー登録完了（メール確認スキップ）: ${email}`);
            return { success: true, skipVerification: true, userId };
        } catch (error) {
            logger.error(`登録に失敗しました（メール確認スキップ）: ${email}`, error);
            return { success: false, error: '登録に失敗しました' };
        }
    }

    const pendingRegistrations = await getPendingRegistrations();
    const pending = await pendingRegistrations.add({
        email,
        passwordHash: await ctx.password.hash(password),
        displayName,
        handle,
    });
    if ('error' in pending) {
        return {
            success: false,
            error: '確認待ちの登録が多すぎます。届いた認証コードを使うか、10分後にやり直してください',
        };
    }
    const { id: registrationId, otp } = pending;

    // OTPをメールで送信
    logger.info(`OTP送信: ${email} OTP=${otpForLog(otp)}`);
    try {
        await sendMail({
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
        logger.info(`OTP送信成功: ${email}`);
        return { success: true, registrationId };
    } catch (error) {
        logger.error(`OTP送信失敗: ${email}`, error);
        await pendingRegistrations.remove(registrationId).catch((err: unknown) => {
            logger.error('仮登録の取り消しに失敗:', err);
        });
        return { success: false, error: 'メールの送信に失敗しました' };
    }
}

const VERIFY_ERRORS = {
    'not-found': '仮登録が見つかりません。もう一度登録してください。',
    expired: '認証コードの有効期限が切れました。もう一度登録してください。',
    'wrong-code': '認証コードが正しくありません',
    'too-many-failures': '認証コードを何度も間違えたため、この登録は無効になりました。もう一度登録してください。',
    'register-failed': '登録に失敗しました',
    'handle-retired': 'この ID は使えなくなりました。別の ID でもう一度登録してください。',
} as const;

// OTPを検証して本登録。仮登録は申し込んだ本人に返した registrationId で引く。
export async function verifyAndRegister(
    registrationId: string,
    otp: string,
): Promise<{ success: true; userId: string } | { success: false; error: string }> {
    // 確認コードを送った後に新規登録を止めたら、本登録もさせない（コードは消費しない）
    if (!appConfig.registrationOpen) return { success: false, error: '現在、新規登録を受け付けていません' };
    const outcome = await (await getPendingRegistrations()).verify(registrationId, otp);
    if (outcome.status === 'register-failed') logger.error('Registration error:', outcome.error);
    if (outcome.status !== 'verified') {
        return { success: false, error: VERIFY_ERRORS[outcome.status] };
    }
    logger.info(`ユーザー登録完了: ${outcome.email}`);
    return { success: true, userId: outcome.userId };
}

// OTPを再送信
export async function resendOTP(registrationId: string): Promise<{ success: boolean; error?: string }> {
    if (!appConfig.registrationOpen) return { success: false, error: '現在、新規登録を受け付けていません' };
    const pending = await (await getPendingRegistrations()).reissue(registrationId);

    if (!pending) {
        return { success: false, error: '仮登録が見つかりません。もう一度登録してください。' };
    }

    const { email, otp } = pending;

    logger.info(`OTP再送信: ${email} OTP=${otpForLog(otp)}`);
    try {
        await sendMail({
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
        logger.error(`OTP再送信失敗: ${email}`, error);
        return { success: false, error: 'メールの送信に失敗しました' };
    }
}

// デバッグ: 起動時に設定を確認（同じ値は config の要約にも出る）
logger.debug(
    [
        'Better Auth 初期化中',
        `メールの送り方=${mailer.kind}`,
        `BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL || 'http://localhost:3001'}`,
        `CORS_ORIGIN=${process.env.CORS_ORIGIN || 'http://localhost:3000'}`,
        `SKIP_EMAIL_VERIFICATION=${SKIP_EMAIL_VERIFICATION ? '有効' : '無効'}`,
    ].join(' '),
);

/**
 * 二段階認証（services/auth/twoFactor）。鍵の暗号化とバックアップコードの HMAC の鍵はサーバーの秘密（auth.$context の
 * secretConfig。BETTER_AUTH_SECRETS で入れ替えられる）から作る。
 * better-auth の設定より前に要るので、使うときに初めて作る。
 */
export const getTwoFactor = (() => {
    const cache: { ready?: Promise<ProductionTwoFactor> } = {};
    return (): Promise<ProductionTwoFactor> => {
        cache.ready ??= auth.$context.then((ctx) => createProductionTwoFactor(ctx.secretConfig, sendAccountNotice));
        return cache.ready;
    };
})();

const secondFactorGate: SecondFactorGate = {
    required: async (userId) => (await getTwoFactor()).twoFactor.isEnabled(userId),
    issue: async (first) => (await getTwoFactor()).challenges.issue(first),
    complete: async (token, code) => (await getTwoFactor()).challenges.complete(token, code),
};

/** better-auth のレート制限を有効にするか。 */
export const authRateLimitEnabled = appConfig.isProduction;

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
        // どこまで本人を確かめたセッションか（services/auth/sessionAssurance.ts）。書くのはサーバーだけ
        additionalFields: sessionAssuranceFields,
    },
    databaseHooks: sessionAssuranceHooks,
    rateLimit: {
        // better-auth の既定と同じ（本番だけ）。ログインを Redis 障害で止めるか（index.ts）もこれに合わせる
        enabled: authRateLimitEnabled,
        window: 60,
        max: 100,
        // secondaryStorage ではなくこちらで共有する（secondaryStorage はセッション・検証トークンの保存先も Redis に移す）
        ...(redis ? { customStorage: createAuthRateLimitStorage(redis, logger) } : {}),
    },
    plugins: [
        // パスワードのログインで ID も受け付ける（better-auth に入る前にメールアドレスへ置き換える）
        signInIdentifierPlugin({
            resolveEmail: createSignInEmailResolver({
                findEmailByHandle: async (handle) => (await userRepository.findByHandle(handle))?.email ?? null,
            }),
        }),
        // ログインの二段階目。パスワードのログインの後始末（セッションを消す）を multiSession より先に行うため最初に置く
        twoFactorPlugin({ gate: secondFactorGate }),
        // ログインしたセッションを「このブラウザーのアカウント」として覚える（切り替えの口は accountSwitchPlugin）
        multiSession({ maximumSessions: 5 }),
        accountSwitchPlugin(),
        // 登録を終えた人をそのままログインさせる（サーバーの中からだけ呼ぶ）
        registrationSignInPlugin({ gate: secondFactorGate }),
        fediverseSignInPlugin({
            getSignIn: () => getFediverseSignIn(),
            secondFactor: secondFactorGate,
            options: async () => ({
                enabled: appConfig.fediverseSignIn.enabled,
                registrationOpen: appConfig.registrationOpen,
                featuredServers: featuredServersFor(
                    await featuredServerList.get(),
                    appConfig.fediverseSignIn.allowedServers,
                ),
            }),
        }),
    ],
    user: {
        additionalFields: {
            // drizzle adapter は「better-auth が書かない NOT NULL・既定値なしの列」があると schema mismatch で止まる。
            // 書くのはサーバーだけ（users は userRepository.createCredentialUser で handle ごと作る）なので input は許さない。
            // required なので、handle を渡せない signUpEmail は users を作る前に失敗する（handle の無い行を作らない）。
            handle: { type: 'string', required: true, input: false },
        },
    },
});

export type Session = typeof auth.$Infer.Session;

/**
 * 登録を終えた人をそのままログインさせ、応答に付けるクッキーを返す（このブラウザーでログインしているほかのアカウントは残す）。
 * 作れなければ null（登録はできているので、ログインし直してもらう）。
 */
export async function signInRegisteredUser(userId: string, requestHeaders: Headers): Promise<string[] | null> {
    try {
        const { headers, response } = await auth.api.registrationSignIn({
            body: { userId },
            headers: requestHeaders,
            returnHeaders: true,
        });
        return response.signedIn ? headers.getSetCookie() : null;
    } catch (error) {
        logger.error('登録の後のログインに失敗しました', error);
        return null;
    }
}

/** users・accounts を better-auth の adapter を通さずに作るときの ID（better-auth と同じ作り方）。 */
export function newBetterAuthId(ctx: Awaited<typeof auth.$context>, model: 'user' | 'account'): string {
    const id = ctx.generateId({ model });
    if (typeof id !== 'string') throw new Error(`better-auth が ${model} の ID を DB に任せる設定になっている`);
    return id;
}

/** 仮登録。コードの HMAC の鍵とユーザー ID の作り方は better-auth と同じもの（auth.$context）を使う。 */
export const getPendingRegistrations = (() => {
    const cache: { ready?: Promise<PendingRegistrations> } = {};
    return (): Promise<PendingRegistrations> => {
        cache.ready ??= auth.$context.then((ctx) =>
            createPendingRegistrations({
                repository: pendingRegistrationRepository,
                now: () => new Date(),
                newId: () => randomBytes(24).toString('base64url'),
                newOtp: generateOTP,
                hashOtp: createOtpHasher(ctx.secret),
                newRecordId: (model) => newBetterAuthId(ctx, model),
            }),
        );
        return cache.ready;
    };
})();

/** フェディバースのログイン。ユーザー ID の作り方は better-auth と同じもの（auth.$context）を使う。 */
const getFediverseSignIn = (() => {
    const cache: { ready?: Promise<FediverseSignIn> } = {};
    return (): Promise<FediverseSignIn> => {
        cache.ready ??= auth.$context.then((ctx) =>
            createProductionFediverseSignIn((model) => newBetterAuthId(ctx, model), sendAccountNotice),
        );
        return cache.ready;
    };
})();

/** サーバーの公開情報とログインに使えるか（コントロールパネルで並べるサーバーを足すときの確認）。 */
export const lookupFediverseServerInfo = async (host: string) => (await getFediverseSignIn()).lookup(host);
