/**
 * メール確認待ちの仮登録の規則。保存先（Postgres）はリポジトリとして注入する。
 *
 * 仮登録は申し込んだ本人に返す ID で引く（メールアドレスでは引かない）。メールアドレスで引くと、他人が同じアドレスで
 * 申し込み直すだけで本人の仮登録をパスワードごと置き換えられ、本人が届いたコードを入れると攻撃者のパスワードの
 * アカウントができてしまう。ID で分ければ、コードを受け取れない側の仮登録は完了できない。
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { LockedPendingRegistration, PendingRegistrationEmailScope, PendingRegistrationRecord } from '@ubichill/db';
import { displayNameKey } from '@ubichill/shared';

export interface PendingRegistrationInput {
    email: string;
    /** better-auth の hasher で作ったハッシュ。平文は渡さない。 */
    passwordHash: string;
    /** 表示名（日本語可・一意）。users.name に入る。 */
    displayName: string;
    /** URL・署名用の ID（一意）。users.handle に入る。 */
    handle: string;
}

export interface PendingRegistrationLimits {
    ttlMs: number;
    /** 同じメールアドレスに同時に出せる仮登録の数（確認メールを大量に送らせない）。 */
    maxPerEmail: number;
    /** コードを間違えられる回数。超えたら仮登録を捨てる（6 桁の総当たりを防ぐ）。 */
    maxFailures: number;
}

export const PENDING_REGISTRATION_LIMITS: PendingRegistrationLimits = {
    ttlMs: 10 * 60 * 1000,
    maxPerEmail: 3,
    maxFailures: 5,
};

export interface PendingRegistrationRepository {
    withEmailLock<T>(email: string, fn: (scope: PendingRegistrationEmailScope) => Promise<T>): Promise<T>;
    withLockedRegistration<T>(
        idHash: string,
        fn: (record: PendingRegistrationRecord | undefined, locked: LockedPendingRegistration) => Promise<T>,
    ): Promise<T>;
    reissue(
        idHash: string,
        otpHash: string,
        expiresAt: Date,
        now: Date,
    ): Promise<Pick<PendingRegistrationRecord, 'email' | 'displayName'> | undefined>;
    remove(idHash: string): Promise<void>;
}

export interface PendingRegistrationDeps {
    repository: PendingRegistrationRepository;
    now: () => Date;
    newId: () => string;
    newOtp: () => string;
    hashOtp: (idHash: string, otp: string) => string;
    /** users.id・accounts.id（better-auth の generateId と揃える）。 */
    newRecordId: (model: 'user' | 'account') => string;
    limits?: PendingRegistrationLimits;
}

export type VerifyOutcome =
    | { status: 'verified'; userId: string; email: string }
    | { status: 'not-found' | 'expired' | 'wrong-code' | 'too-many-failures' }
    | { status: 'register-failed'; error: unknown };

/** better-auth は users.email を小文字で保存し、ログインでも小文字で引く。仮登録も同じ形で数える・保存する。 */
export const normalizeEmail = (email: string): string => email.toLowerCase();

export const hashRegistrationId = (id: string): string => createHash('sha256').update(id).digest('base64url');

/** コードの HMAC。登録 ID のハッシュも混ぜ、同じコードでも行ごとに違う値にする（行どうしで突き合わせられない）。 */
export const createOtpHasher =
    (secret: string) =>
    (idHash: string, otp: string): string =>
        createHmac('sha256', secret).update(`ubichill/pending-registration/otp\n${idHash}\n${otp}`).digest('base64url');

const sameHash = (a: string, b: string): boolean => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

type Judged<R> =
    | { status: 'not-found' }
    | { status: 'expired' }
    | { status: 'too-many-failures' }
    | { status: 'wrong-code'; failures: number }
    | { status: 'verified'; record: R };

/** 押さえた仮登録と入力されたコード（のハッシュ）から、どうするかを決める。 */
export function judgeVerification<R extends Pick<PendingRegistrationRecord, 'otpHash' | 'failures' | 'expiresAt'>>(
    record: R | undefined,
    presentedOtpHash: string,
    now: Date,
    limits: PendingRegistrationLimits,
): Judged<R> {
    if (!record) return { status: 'not-found' };
    if (record.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
    if (sameHash(record.otpHash, presentedOtpHash)) return { status: 'verified', record };
    const failures = record.failures + 1;
    return failures >= limits.maxFailures ? { status: 'too-many-failures' } : { status: 'wrong-code', failures };
}

export function createPendingRegistrations(deps: PendingRegistrationDeps) {
    const limits = deps.limits ?? PENDING_REGISTRATION_LIMITS;
    const expiresAt = (now: Date) => new Date(now.getTime() + limits.ttlMs);

    return {
        /** 仮登録を作る。同じアドレスの期限内の仮登録が上限に達していれば作らない。 */
        async add(
            input: PendingRegistrationInput,
        ): Promise<{ id: string; otp: string } | { error: 'too-many-pending' }> {
            const email = normalizeEmail(input.email);
            return deps.repository.withEmailLock(email, async (scope) => {
                const now = deps.now();
                if ((await scope.countActive(now)) >= limits.maxPerEmail) return { error: 'too-many-pending' as const };
                const id = deps.newId();
                const otp = deps.newOtp();
                const idHash = hashRegistrationId(id);
                await scope.insert({
                    ...input,
                    email,
                    idHash,
                    otpHash: deps.hashOtp(idHash, otp),
                    failures: 0,
                    expiresAt: expiresAt(now),
                });
                return { id, otp };
            });
        },

        /**
         * コードを確かめ、合えば同じトランザクションで本登録して仮登録を消す。本登録に失敗したらロールバックし、
         * 仮登録は残る（同じコードでやり直せる）。
         */
        async verify(id: string, otp: string): Promise<VerifyOutcome> {
            const idHash = hashRegistrationId(id);
            const presented = deps.hashOtp(idHash, otp);
            try {
                return await deps.repository.withLockedRegistration(
                    idHash,
                    async (record, locked): Promise<VerifyOutcome> => {
                        const now = deps.now();
                        const judged = judgeVerification(record, presented, now, limits);
                        switch (judged.status) {
                            case 'not-found':
                                return judged;
                            case 'expired':
                            case 'too-many-failures':
                                await locked.remove();
                                return { status: judged.status };
                            case 'wrong-code':
                                await locked.setFailures(judged.failures);
                                return { status: 'wrong-code' };
                            case 'verified': {
                                const userId = deps.newRecordId('user');
                                await locked.createCredentialUser({
                                    userId,
                                    accountId: deps.newRecordId('account'),
                                    email: judged.record.email,
                                    name: judged.record.displayName,
                                    handle: judged.record.handle,
                                    displayNameKey: displayNameKey(judged.record.displayName),
                                    passwordHash: judged.record.passwordHash,
                                    now,
                                });
                                await locked.remove();
                                return { status: 'verified', userId, email: judged.record.email };
                            }
                        }
                    },
                );
            } catch (error) {
                return { status: 'register-failed', error };
            }
        },

        /** コードを作り直す。間違えた回数は戻さない（再送信で総当たりの回数を増やさせない）。 */
        async reissue(id: string): Promise<{ email: string; displayName: string; otp: string } | undefined> {
            const idHash = hashRegistrationId(id);
            const otp = deps.newOtp();
            const now = deps.now();
            const row = await deps.repository.reissue(idHash, deps.hashOtp(idHash, otp), expiresAt(now), now);
            return row && { ...row, otp };
        },

        remove: (id: string): Promise<void> => deps.repository.remove(hashRegistrationId(id)),
    };
}

export type PendingRegistrations = ReturnType<typeof createPendingRegistrations>;
