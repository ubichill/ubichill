/**
 * 二段階認証（認証アプリとバックアップコード）の設定と、コードの確かめ。
 * - 有効にするには、認証アプリに鍵を登録し、表示されたコードを 1 回入れる（鍵を正しく登録できたことを確かめる）。
 * - 無効にする・バックアップコードを作り直すには、今のコード（かバックアップコード）を求める。奪われたセッションだけでは外せない。
 * - 続けて間違えると、ログインも設定もしばらく止める（6 桁の総当たりを防ぐ）。
 * 保存先・暗号化・HMAC・通知は注入する（本番は twoFactorService.ts）。
 */
import { timingSafeEqual } from 'node:crypto';
import type { LockedTwoFactor, TwoFactorRecord } from '@ubichill/db';
import type { TwoFactorBackupCodes, TwoFactorSetup, TwoFactorStatus } from '@ubichill/shared';
import type { SecretBox } from '../../../lib/secretBox';
import { newBackupCodes, normalizeBackupCode } from './backupCodes';
import { base32Encode, matchTotp, otpauthUri } from './totp';

export interface TwoFactorLimits {
    /** 続けて間違えられる回数（ログインと設定で共通）。超えたら lockMs の間止める */
    maxFailures: number;
    lockMs: number;
}

export const TWO_FACTOR_LIMITS: TwoFactorLimits = { maxFailures: 10, lockMs: 15 * 60 * 1000 };

/** 認証アプリの鍵の長さ（RFC 4226 が勧める 160 ビット） */
const SECRET_BYTES = 20;

export interface TwoFactorDeps {
    repository: {
        find(userId: string): Promise<TwoFactorRecord | undefined>;
        startSetup(userId: string, secret: string, now: Date): Promise<'started' | 'already-enabled'>;
        withLocked<T>(
            userId: string,
            fn: (record: TwoFactorRecord | undefined, locked: LockedTwoFactor) => Promise<T>,
        ): Promise<T>;
    };
    /** 鍵の暗号化（context にユーザー ID を入れる） */
    box: SecretBox;
    hashBackupCode(userId: string, code: string): string;
    randomBytes(size: number): Uint8Array;
    /** 認証アプリに出る名前（ユーザーがいなければ null） */
    label(userId: string): Promise<{ issuer: string; account: string } | null>;
    /** 連絡先に知らせる（失敗しても投げない） */
    notify(userId: string, subject: string, text: string): Promise<void>;
    warn(message: string): void;
    now(): Date;
    limits?: TwoFactorLimits;
}

export type TwoFactorOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 429; error: string };

/** コードを確かめた結果。 */
export type CodeCheck =
    | { ok: true; via: 'totp' | 'backup-code'; backupCodesLeft: number }
    | { ok: false; reason: 'not-enabled' | 'invalid-code' | 'locked' };

const sameHash = (a: string, b: string): boolean => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

const fail = <T>(status: 400 | 404 | 409 | 429, error: string): TwoFactorOutcome<T> => ({ ok: false, status, error });

export function createTwoFactor(deps: TwoFactorDeps) {
    const limits = deps.limits ?? TWO_FACTOR_LIMITS;
    const lockMinutes = Math.round(limits.lockMs / 60_000);
    const lockedError = `コードを何度も間違えたため、しばらく使えません。${lockMinutes} 分ほどしてからお試しください`;

    /** 行を押さえた中でコードを確かめ、使ったコード・間違えた回数を書く。`locking` は今回で止めたか。 */
    const check = async (
        userId: string,
        record: TwoFactorRecord | undefined,
        locked: LockedTwoFactor,
        code: string,
    ): Promise<{ result: CodeCheck; locking: boolean }> => {
        const now = deps.now();
        if (!record?.enabledAt) return { result: { ok: false, reason: 'not-enabled' }, locking: false };
        if (record.lockedUntil && record.lockedUntil > now) {
            return { result: { ok: false, reason: 'locked' }, locking: false };
        }
        const secret = deps.box.open(record.secret, userId);
        if (!secret) deps.warn(`二段階認証の鍵を開けませんでした（サーバーの秘密が変わった？）: ${userId}`);
        const step = secret ? matchTotp(secret, code.replace(/\s/g, ''), now, record.lastUsedStep) : null;
        if (step !== null) {
            await locked.update({ lastUsedStep: step, failures: 0, lockedUntil: null });
            return {
                result: { ok: true, via: 'totp', backupCodesLeft: record.backupCodeHashes.length },
                locking: false,
            };
        }
        const backup = normalizeBackupCode(code);
        const presented = backup ? deps.hashBackupCode(userId, backup) : null;
        const index = presented ? record.backupCodeHashes.findIndex((hash) => sameHash(hash, presented)) : -1;
        if (index >= 0) {
            const left = record.backupCodeHashes.filter((_, i) => i !== index);
            await locked.update({ backupCodeHashes: left, failures: 0, lockedUntil: null });
            return { result: { ok: true, via: 'backup-code', backupCodesLeft: left.length }, locking: false };
        }
        const failures = record.failures + 1;
        const locking = failures >= limits.maxFailures;
        await locked.update(
            locking
                ? { failures: 0, lockedUntil: new Date(now.getTime() + limits.lockMs) }
                : { failures, lockedUntil: null },
        );
        return { result: { ok: false, reason: locking ? 'locked' : 'invalid-code' }, locking };
    };

    /** コードを確かめ、合えば `onValid` を同じトランザクションで実行する。止めたときは知らせる。 */
    const verifyThen = async <T>(
        userId: string,
        code: unknown,
        onValid: (locked: LockedTwoFactor, checked: CodeCheck & { ok: true }) => Promise<T>,
    ): Promise<{ checked: CodeCheck; value?: T }> => {
        const presented = typeof code === 'string' ? code.slice(0, 64) : '';
        const outcome = await deps.repository.withLocked(userId, async (record, locked) => {
            const { result, locking } = await check(userId, record, locked, presented);
            return { result, locking, value: result.ok ? await onValid(locked, result) : undefined };
        });
        if (outcome.locking) {
            await deps.notify(
                userId,
                '二段階認証のコードが続けて間違えられました',
                `二段階認証のコードが続けて間違えられたため、${lockMinutes} 分間ログインを止めました。\n\n` +
                    '心当たりが無い場合は、パスワードかフェディバースのアカウントが他人に使われているかもしれません。' +
                    'パスワードを変更し、設定の「アカウント」でログイン中の端末を確かめてください。',
            );
        }
        return { checked: outcome.result, value: outcome.value };
    };

    const checkError = <T>(checked: CodeCheck & { ok: false }): TwoFactorOutcome<T> => {
        switch (checked.reason) {
            case 'not-enabled':
                return fail(409, '二段階認証は有効になっていません');
            case 'locked':
                return fail(429, lockedError);
            case 'invalid-code':
                return fail(400, 'コードが正しくありません');
        }
    };

    const issueBackupCodes = (userId: string) => {
        const codes = newBackupCodes(deps.randomBytes);
        return { codes, hashes: codes.map((code) => deps.hashBackupCode(userId, normalizeBackupCode(code) ?? code)) };
    };

    return {
        lockedError,

        async status(userId: string): Promise<TwoFactorStatus> {
            const record = await deps.repository.find(userId);
            const enabled = !!record?.enabledAt;
            return { enabled, backupCodesLeft: enabled ? (record?.backupCodeHashes.length ?? 0) : 0 };
        },

        async isEnabled(userId: string): Promise<boolean> {
            return !!(await deps.repository.find(userId))?.enabledAt;
        },

        /** 設定を始める（認証アプリに登録する鍵を作る）。前の設定の途中は捨てる。 */
        async beginSetup(userId: string): Promise<TwoFactorOutcome<TwoFactorSetup>> {
            const label = await deps.label(userId);
            if (!label) return fail(404, 'アカウントが見つかりません');
            const secret = deps.randomBytes(SECRET_BYTES);
            const started = await deps.repository.startSetup(userId, deps.box.seal(secret, userId), deps.now());
            if (started === 'already-enabled') return fail(409, '二段階認証は既に有効です');
            return { ok: true, value: { secret: base32Encode(secret), uri: otpauthUri({ secret, ...label }) } };
        },

        /** 認証アプリのコードで登録を確かめて有効にし、バックアップコードを返す（平文はこの 1 回だけ）。 */
        async enable(userId: string, code: unknown): Promise<TwoFactorOutcome<TwoFactorBackupCodes>> {
            const presented = typeof code === 'string' ? code.replace(/\s/g, '') : '';
            const outcome = await deps.repository.withLocked(
                userId,
                async (record, locked): Promise<TwoFactorOutcome<TwoFactorBackupCodes>> => {
                    if (!record) return fail(404, '先に設定を始めてください');
                    if (record.enabledAt) return fail(409, '二段階認証は既に有効です');
                    const secret = deps.box.open(record.secret, userId);
                    if (!secret) return fail(404, 'もう一度最初から設定してください');
                    const now = deps.now();
                    const step = matchTotp(secret, presented, now, null);
                    if (step === null) {
                        return fail(400, 'コードが正しくありません。認証アプリに今出ているコードを入れてください');
                    }
                    const { codes, hashes } = issueBackupCodes(userId);
                    await locked.update({
                        enabledAt: now,
                        lastUsedStep: step,
                        backupCodeHashes: hashes,
                        failures: 0,
                        lockedUntil: null,
                    });
                    return { ok: true, value: { backupCodes: codes } };
                },
            );
            if (outcome.ok) {
                await deps.notify(
                    userId,
                    '二段階認証を有効にしました',
                    'これから、ログインのたびに認証アプリのコードを求めます。\n\n' +
                        '心当たりが無い場合は、すぐに設定の「アカウント」でログイン中の端末を確かめてください。',
                );
            }
            return outcome;
        },

        /** 今のコード（かバックアップコード）を確かめて無効にする。 */
        async disable(userId: string, code: unknown): Promise<TwoFactorOutcome<null>> {
            const { checked } = await verifyThen(userId, code, (locked) => locked.remove());
            if (!checked.ok) return checkError(checked);
            await deps.notify(
                userId,
                '二段階認証を無効にしました',
                'ログインのときに認証アプリのコードを求めなくなりました。\n\n' +
                    '心当たりが無い場合は、設定の「アカウント」でほかの端末をログアウトし、パスワードを変更してください。',
            );
            return { ok: true, value: null };
        },

        /** 今のコード（かバックアップコード）を確かめて、バックアップコードを作り直す（前のものは使えなくなる）。 */
        async regenerateBackupCodes(userId: string, code: unknown): Promise<TwoFactorOutcome<TwoFactorBackupCodes>> {
            const { checked, value } = await verifyThen(userId, code, async (locked) => {
                const { codes, hashes } = issueBackupCodes(userId);
                await locked.update({ backupCodeHashes: hashes });
                return codes;
            });
            if (!checked.ok) return checkError(checked);
            await deps.notify(
                userId,
                'バックアップコードを作り直しました',
                '二段階認証のバックアップコードを作り直しました。前のバックアップコードは使えません。',
            );
            return { ok: true, value: { backupCodes: value ?? [] } };
        },

        /** ログインの二段階目。バックアップコードを使ったときは知らせる（残りが少ないことに気付けるように）。 */
        async verifyForSignIn(userId: string, code: unknown): Promise<CodeCheck> {
            const { checked } = await verifyThen(userId, code, async () => undefined);
            if (checked.ok && checked.via === 'backup-code') {
                await deps.notify(
                    userId,
                    'バックアップコードでログインしました',
                    `二段階認証のバックアップコードでログインしました。残りは ${checked.backupCodesLeft} 個です。\n\n` +
                        '認証アプリを使えなくなった場合は、設定の「アカウント」で二段階認証を設定し直してください。' +
                        '心当たりが無い場合は、パスワードを変更し、ログイン中の端末を確かめてください。',
                );
            }
            return checked;
        },
    };
}

export type TwoFactor = ReturnType<typeof createTwoFactor>;
