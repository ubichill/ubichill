/**
 * 登録の 3 つの口の回数の制限。どれも未認証で、メールを送る・パスワードをハッシュする・コードを確かめる。
 * 数える単位は IP・メールアドレス・登録 ID。メールアドレスと登録 ID はハッシュしてキーにする（Redis に平文で置かない）。
 */
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sharedLimiter } from '../../lib/rateLimit';
import { hashRegistrationId, normalizeEmail } from '../../services/auth/pendingRegistrations';

const MINUTE = 60 * 1000;

export const REGISTRATION_RATE_LIMITS = {
    registerPerIp: {
        windowMs: 15 * MINUTE,
        limit: 30,
        error: '登録の申し込みが多すぎます。しばらくしてから再試行してください。',
    },
    registerPerEmail: {
        windowMs: 60 * MINUTE,
        limit: 3,
        error: 'このメールアドレスへの認証コードの送信が多すぎます。1 時間ほどしてから再試行してください。',
    },
    verifyPerIp: {
        windowMs: 15 * MINUTE,
        limit: 60,
        error: '認証の試行が多すぎます。しばらくしてから再試行してください。',
    },
    resendPerIp: {
        windowMs: 15 * MINUTE,
        limit: 10,
        error: '認証コードの再送信が多すぎます。しばらくしてから再試行してください。',
    },
    resendInterval: {
        windowMs: MINUTE,
        limit: 1,
        error: '認証コードの再送信は 60 秒以上あけてください。',
    },
    // 再送信は仮登録の期限を延ばすので、窓は延ばせる寿命（limit × ttl）より長くする。窓が明けたときには仮登録が消えている
    resendPerRegistration: {
        windowMs: 60 * MINUTE,
        limit: 3,
        error: '認証コードの再送信は 3 回までです。もう一度登録してください。',
    },
} as const;

const fieldOf = (body: unknown, field: string): string | undefined => {
    if (typeof body !== 'object' || body === null) return undefined;
    const value: unknown = (body as Record<string, unknown>)[field];
    return typeof value === 'string' && value !== '' ? value : undefined;
};

/** メールアドレスごとに数えるキー。取れなければ undefined（数えない。共通のキーにまとめると他人の枠を使い切れる）。 */
export const emailKeyOf = (body: unknown): string | undefined => {
    const email = fieldOf(body, 'email');
    return email === undefined ? undefined : createHash('sha256').update(normalizeEmail(email)).digest('base64url');
};

/** 登録 ID ごとに数えるキー。仮登録の保存と同じハッシュ。 */
export const registrationKeyOf = (body: unknown): string | undefined => {
    const id = fieldOf(body, 'registrationId');
    return id === undefined ? undefined : hashRegistrationId(id);
};

/**
 * `disabled` はメール確認をしない環境（SKIP_EMAIL_VERIFICATION）。メールもコードも無く、負荷試験・E2E が
 * 1 つの IP から多くの人を登録するので数えない（全体の limiter は効いたまま）。
 */
export function createRegistrationLimiters({ disabled }: { disabled: boolean }): {
    register: RequestHandler[];
    verify: RequestHandler[];
    resendOtp: RequestHandler[];
} {
    const rule = (
        name: string,
        { windowMs, limit, error }: { windowMs: number; limit: number; error: string },
        keyOf?: (body: unknown) => string | undefined,
        skipFailedRequests = false,
    ): RequestHandler =>
        sharedLimiter(name, windowMs, limit, error, {
            skipFailedRequests,
            skip: (req) => disabled || (keyOf !== undefined && keyOf(req.body) === undefined),
            ...(keyOf ? { keyGenerator: (req) => keyOf(req.body) ?? '' } : {}),
        });
    const limits = REGISTRATION_RATE_LIMITS;
    return {
        // メールアドレスの数は、送った（200 で終わった）申し込みだけ数える。入力の誤りで本人を締め出さない
        register: [
            rule('register-ip', limits.registerPerIp),
            rule('register-email', limits.registerPerEmail, emailKeyOf, true),
        ],
        verify: [rule('verify-ip', limits.verifyPerIp)],
        // 間隔を先に見る。間隔で断った分を 1 登録あたりの回数に数えない
        resendOtp: [
            rule('resend-otp-ip', limits.resendPerIp),
            rule('resend-otp-interval', limits.resendInterval, registrationKeyOf),
            rule('resend-otp-registration', limits.resendPerRegistration, registrationKeyOf),
        ],
    };
}
