/**
 * メールアドレスの追加（メールなしで登録したユーザーが、ログイン方法と連絡先にメールを足す）。
 * 設定の「ログイン方法」でアドレスとパスワードを入れ、届いたコードで確かめると、メール・パスワードでもログインできる。
 * 保存先・パスワードの hasher・メールの送信は注入する（本番は emailLinkService.ts）。
 */
import type { EmailLinkRecord, LinkEmailOutcome, LockedEmailLink } from '@ubichill/db';
import { isPlaceholderEmail, isReservedEmail } from '@ubichill/shared';
import { z } from 'zod';
import { judgeVerification, normalizeEmail } from './pendingRegistrations';

export interface EmailLinkLimits {
    ttlMs: number;
    /** コードを間違えられる回数。超えたら申し込みを捨てる（6 桁の総当たりを防ぐ） */
    maxFailures: number;
}

export const EMAIL_LINK_LIMITS: EmailLinkLimits = { ttlMs: 10 * 60 * 1000, maxFailures: 5 };

export interface EmailLinkDeps {
    repository: {
        put(record: Omit<EmailLinkRecord, 'failures'>): Promise<void>;
        withLocked<T>(
            userId: string,
            fn: (record: EmailLinkRecord | undefined, locked: LockedEmailLink) => Promise<T>,
        ): Promise<T>;
    };
    /** 今のユーザー（メールが内部値のままか・パスワードがあるか） */
    user(userId: string): Promise<{ email: string; hasPassword: boolean } | undefined>;
    /** ほかのユーザーが使っているアドレスか */
    emailInUse(email: string): Promise<boolean>;
    password: { hash(password: string): Promise<string>; minLength: number; maxLength: number };
    newOtp(): string;
    hashOtp(key: string, otp: string): string;
    newAccountId(): string;
    sendCode(to: string, otp: string): Promise<void>;
    /** 足した後（このセッションはパスワードを決めた本人なので、パスワードで確かめたセッションとして扱う） */
    afterLinked(userId: string, sessionId: string): Promise<void>;
    /** メール確認を省く環境（SKIP_EMAIL_VERIFICATION）。コードを送らずにすぐ足す */
    skipVerification: boolean;
    now(): Date;
    limits?: EmailLinkLimits;
}

export type EmailLinkOutcome<T extends string> =
    | { ok: true; status: T }
    | { ok: false; status: 400 | 404 | 409 | 503; error: string };

const LINK_ERRORS: Record<Exclude<LinkEmailOutcome, 'linked'>, { status: 409; error: string }> = {
    'email-taken': { status: 409, error: 'このメールアドレスは既に使われています' },
    'already-has-email': { status: 409, error: 'このアカウントには既にメールアドレスがあります' },
};

const otpKey = (userId: string) => `email-link:${userId}`;

export function createEmailLinks(deps: EmailLinkDeps) {
    const limits = deps.limits ?? EMAIL_LINK_LIMITS;

    const linkNow = async (
        locked: LockedEmailLink,
        input: { userId: string; sessionId: string; email: string; passwordHash: string },
    ): Promise<EmailLinkOutcome<'linked'>> => {
        const linked = await locked.link({
            email: input.email,
            passwordHash: input.passwordHash,
            accountId: deps.newAccountId(),
            now: deps.now(),
        });
        await locked.remove();
        if (linked !== 'linked') return { ok: false, ...LINK_ERRORS[linked] };
        await deps.afterLinked(input.userId, input.sessionId);
        return { ok: true, status: 'linked' };
    };

    return {
        /** アドレスとパスワードを受け取り、コードを送る（メール確認を省く環境ではすぐ足す）。 */
        async start(input: {
            userId: string;
            sessionId: string;
            email: unknown;
            password: unknown;
        }): Promise<EmailLinkOutcome<'sent' | 'linked'>> {
            const email = typeof input.email === 'string' ? normalizeEmail(input.email.trim()) : '';
            if (!z.email().safeParse(email).success || isReservedEmail(email)) {
                return { ok: false, status: 400, error: 'メールアドレスの形式が正しくありません' };
            }
            const password = typeof input.password === 'string' ? input.password : '';
            const { minLength, maxLength } = deps.password;
            if (password.length < minLength || password.length > maxLength) {
                return {
                    ok: false,
                    status: 400,
                    error: `パスワードは${minLength}文字以上${maxLength}文字以下で入力してください`,
                };
            }
            const user = await deps.user(input.userId);
            if (!user) return { ok: false, status: 404, error: 'アカウントが見つかりません' };
            if (user.hasPassword || !isPlaceholderEmail(user.email))
                return { ok: false, ...LINK_ERRORS['already-has-email'] };
            if (await deps.emailInUse(email)) return { ok: false, ...LINK_ERRORS['email-taken'] };
            const passwordHash = await deps.password.hash(password);

            if (deps.skipVerification) {
                return deps.repository.withLocked(input.userId, (_record, locked) =>
                    linkNow(locked, { userId: input.userId, sessionId: input.sessionId, email, passwordHash }),
                );
            }
            const otp = deps.newOtp();
            await deps.repository.put({
                userId: input.userId,
                email,
                passwordHash,
                otpHash: deps.hashOtp(otpKey(input.userId), otp),
                expiresAt: new Date(deps.now().getTime() + limits.ttlMs),
            });
            try {
                await deps.sendCode(email, otp);
            } catch {
                await deps.repository.withLocked(input.userId, (_record, locked) => locked.remove());
                return { ok: false, status: 503, error: 'メールを送れませんでした。しばらくしてからお試しください' };
            }
            return { ok: true, status: 'sent' };
        },

        /** 届いたコードを確かめ、合えば同じトランザクションでメールアドレスとパスワードを足す。 */
        async verify(input: { userId: string; sessionId: string; code: unknown }): Promise<EmailLinkOutcome<'linked'>> {
            const code = typeof input.code === 'string' ? input.code.trim() : '';
            const presented = deps.hashOtp(otpKey(input.userId), code);
            return deps.repository.withLocked(input.userId, async (record, locked) => {
                const judged = judgeVerification(record, presented, deps.now(), limits);
                switch (judged.status) {
                    case 'not-found':
                        return {
                            ok: false,
                            status: 404,
                            error: '確認待ちのメールアドレスがありません。もう一度入力してください',
                        };
                    case 'expired':
                        await locked.remove();
                        return {
                            ok: false,
                            status: 400,
                            error: 'コードの有効期限が切れました。もう一度送ってください',
                        };
                    case 'too-many-failures':
                        await locked.remove();
                        return {
                            ok: false,
                            status: 400,
                            error: 'コードを何度も間違えたため、取り消しました。もう一度送ってください',
                        };
                    case 'wrong-code':
                        await locked.setFailures(judged.failures);
                        return { ok: false, status: 400, error: 'コードが正しくありません' };
                    case 'verified':
                        return linkNow(locked, {
                            userId: input.userId,
                            sessionId: input.sessionId,
                            email: judged.record.email,
                            passwordHash: judged.record.passwordHash,
                        });
                }
            });
        },
    };
}

export type EmailLinks = ReturnType<typeof createEmailLinks>;
