/**
 * 二段階認証（認証アプリとバックアップコード）の設定と、コードの確かめ。
 * - 有効にするには、認証アプリに鍵を登録し、表示されたコードを 1 回入れる（鍵を正しく登録できたことを確かめる）。
 * - 無効にする・バックアップコードを作り直すには、今のコード（かバックアップコード）を求める。奪われたセッションだけでは外せない。
 * - ログインで続けて間違えると、しばらくログインを止める（6 桁の総当たりを防ぐ）。止めるたびに長くする。
 *   設定での間違い（無効にする・作り直す）は数えない（奪われたセッションで本人のログインを止めさせない。
 *   回数は routes の制限で絞る）。
 * 保存先・暗号化・HMAC・通知は注入する（本番は twoFactorService.ts）。
 */
import type { LockedTwoFactor, TwoFactorRecord } from '@ubichill/db';
import type { TwoFactorBackupCodes, TwoFactorSetup, TwoFactorStatus } from '@ubichill/shared';
import type { SecretBox } from '../../../lib/secretBox';
import { newBackupCodes, normalizeBackupCode } from './backupCodes';
import { base32Encode, matchTotp, otpauthUri } from './totp';

export interface TwoFactorLimits {
    /** ログインで続けて間違えられる回数。超えるたびに止める */
    maxFailures: number;
    /** 最初に止める長さ。続けて止めるたびに倍にする（maxLockMs まで） */
    lockMs: number;
    maxLockMs: number;
}

export const TWO_FACTOR_LIMITS: TwoFactorLimits = {
    maxFailures: 10,
    lockMs: 15 * 60 * 1000,
    maxLockMs: 24 * 60 * 60 * 1000,
};

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
    /** バックアップコードの HMAC（どの秘密で作ったかを含む。lib/serverKeys.ts） */
    backupCodeHash: {
        create(userId: string, code: string): string;
        matches(userId: string, code: string, stored: string): boolean;
    };
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

const fail = <T>(status: 400 | 404 | 409 | 429, error: string): TwoFactorOutcome<T> => ({ ok: false, status, error });

export function createTwoFactor(deps: TwoFactorDeps) {
    const limits = deps.limits ?? TWO_FACTOR_LIMITS;
    const lockedError = 'コードを何度も間違えたため、しばらくログインできません。時間をおいてからお試しください';

    /** 続けて間違えた回数が maxFailures の何倍目かで、止める長さを倍にしていく */
    const lockMsFor = (failures: number) =>
        Math.min(limits.lockMs * 2 ** (Math.floor(failures / limits.maxFailures) - 1), limits.maxLockMs);

    /**
     * 行を押さえた中でコードを確かめ、使ったコード・間違えた回数を書く。間違いを数えて止めるのはログインだけ。
     * `lockedFor` は今回で止めた長さ（止めなければ null）。
     */
    const check = async (
        userId: string,
        record: TwoFactorRecord | undefined,
        locked: LockedTwoFactor,
        code: string,
        purpose: 'sign-in' | 'settings',
    ): Promise<{ result: CodeCheck; lockedFor: number | null }> => {
        const now = deps.now();
        const signIn = purpose === 'sign-in';
        if (!record?.enabledAt) return { result: { ok: false, reason: 'not-enabled' }, lockedFor: null };
        if (signIn && record.lockedUntil && record.lockedUntil > now) {
            return { result: { ok: false, reason: 'locked' }, lockedFor: null };
        }
        const secret = deps.box.open(record.secret, userId);
        if (!secret) deps.warn(`二段階認証の鍵を開けませんでした（サーバーの秘密を外した？）: ${userId}`);
        const step = secret ? matchTotp(secret, code.replace(/\s/g, ''), now, record.lastUsedStep) : null;
        // 本人がコードを持っていると分かったので、ログインを止めていたら戻す
        const cleared = { failures: 0, lockedUntil: null };
        if (step !== null) {
            await locked.update({ lastUsedStep: step, ...cleared });
            return {
                result: { ok: true, via: 'totp', backupCodesLeft: record.backupCodeHashes.length },
                lockedFor: null,
            };
        }
        const backup = normalizeBackupCode(code);
        const index = backup
            ? record.backupCodeHashes.findIndex((stored) => deps.backupCodeHash.matches(userId, backup, stored))
            : -1;
        if (index >= 0) {
            const left = record.backupCodeHashes.filter((_, i) => i !== index);
            await locked.update({ backupCodeHashes: left, ...cleared });
            return { result: { ok: true, via: 'backup-code', backupCodesLeft: left.length }, lockedFor: null };
        }
        if (!signIn) return { result: { ok: false, reason: 'invalid-code' }, lockedFor: null };
        const failures = record.failures + 1;
        const lockedFor = failures % limits.maxFailures === 0 ? lockMsFor(failures) : null;
        await locked.update({
            failures,
            lockedUntil: lockedFor === null ? record.lockedUntil : new Date(now.getTime() + lockedFor),
        });
        return { result: { ok: false, reason: lockedFor === null ? 'invalid-code' : 'locked' }, lockedFor };
    };

    /** コードを確かめ、合えば `onValid` を同じトランザクションで実行する。ログインを止めたときは知らせる。 */
    const verifyThen = async <T>(
        userId: string,
        code: unknown,
        purpose: 'sign-in' | 'settings',
        onValid: (locked: LockedTwoFactor, checked: CodeCheck & { ok: true }) => Promise<T>,
    ): Promise<{ checked: CodeCheck; value?: T }> => {
        const presented = typeof code === 'string' ? code.slice(0, 64) : '';
        const outcome = await deps.repository.withLocked(userId, async (record, locked) => {
            const { result, lockedFor } = await check(userId, record, locked, presented, purpose);
            return { result, lockedFor, value: result.ok ? await onValid(locked, result) : undefined };
        });
        if (outcome.lockedFor !== null) {
            await deps.notify(
                userId,
                '二段階認証のコードが続けて間違えられました',
                `ログインのときに二段階認証のコードが続けて間違えられたため、${durationText(outcome.lockedFor)}` +
                    '新しいログインを止めました。\n\n' +
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
        return {
            codes,
            hashes: codes.map((code) => deps.backupCodeHash.create(userId, normalizeBackupCode(code) ?? code)),
        };
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
            const { checked } = await verifyThen(userId, code, 'settings', (locked) => locked.remove());
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
            const { checked, value } = await verifyThen(userId, code, 'settings', async (locked) => {
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
            const { checked } = await verifyThen(userId, code, 'sign-in', async () => undefined);
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

/** 止めた長さを「15 分間」「2 時間」のように書く */
function durationText(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    return minutes < 60 ? `${minutes} 分間` : `${Math.round(minutes / 60)} 時間`;
}
