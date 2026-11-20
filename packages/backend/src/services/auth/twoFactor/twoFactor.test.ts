import { createHash, randomBytes } from 'node:crypto';
import type { LockedTwoFactor, TwoFactorRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { createSecretBox } from '../../../lib/secretBox';
import { hotp, totpStep } from './totp';
import { createTwoFactor, TWO_FACTOR_LIMITS } from './twoFactor';

/** DB の代わり（1 ユーザー 1 行。withLocked は順番に実行する） */
function memoryRepository() {
    const rows = new Map<string, TwoFactorRecord>();
    const queue: { tail: Promise<unknown> } = { tail: Promise.resolve() };
    return {
        rows,
        find: async (userId: string) => (rows.has(userId) ? { ...(rows.get(userId) as TwoFactorRecord) } : undefined),
        startSetup: async (userId: string, secret: string, now: Date) => {
            if (rows.get(userId)?.enabledAt) return 'already-enabled' as const;
            rows.set(userId, {
                userId,
                secret,
                enabledAt: null,
                lastUsedStep: null,
                backupCodeHashes: [],
                failures: 0,
                lockedUntil: null,
                createdAt: now,
            });
            return 'started' as const;
        },
        withLocked<T>(
            userId: string,
            fn: (record: TwoFactorRecord | undefined, locked: LockedTwoFactor) => Promise<T>,
        ): Promise<T> {
            const run = queue.tail.then(() => {
                const record = rows.get(userId);
                return fn(record ? { ...record, backupCodeHashes: [...record.backupCodeHashes] } : undefined, {
                    update: async (patch) => {
                        const current = rows.get(userId);
                        if (current) rows.set(userId, { ...current, ...patch });
                    },
                    remove: async () => {
                        rows.delete(userId);
                    },
                });
            });
            queue.tail = run.catch(() => undefined);
            return run;
        },
    };
}

function setup() {
    const repository = memoryRepository();
    const clock = { now: new Date('2026-11-21T00:00:00Z') };
    const notices: Array<{ userId: string; subject: string; text: string }> = [];
    const warnings: string[] = [];
    const box = createSecretBox('server-secret', 'two-factor/totp-secret');
    const twoFactor = createTwoFactor({
        repository,
        box,
        hashBackupCode: (userId, code) => createHash('sha256').update(`${userId}\n${code}`).digest('base64url'),
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
        label: async (userId) =>
            userId === 'ghost' ? null : { issuer: 'Ubichill', account: `@${userId}@ubi.example` },
        notify: async (userId, subject, text) => {
            notices.push({ userId, subject, text });
        },
        warn: (message) => warnings.push(message),
        now: () => clock.now,
    });
    /** 認証アプリが今出すコード（区切りをずらせる） */
    const codeOf = (userId: string, offset = 0) => {
        const record = repository.rows.get(userId);
        const secret = record && box.open(record.secret, userId);
        if (!secret) throw new Error('鍵がありません');
        return hotp(secret, totpStep(clock.now) + offset);
    };
    const advance = (ms: number) => {
        clock.now = new Date(clock.now.getTime() + ms);
    };
    /** 有効にして、バックアップコードを返す */
    const enabled = async (userId: string) => {
        await twoFactor.beginSetup(userId);
        const outcome = await twoFactor.enable(userId, codeOf(userId));
        if (!outcome.ok) throw new Error(outcome.error);
        advance(30_000);
        notices.length = 0;
        return outcome.value.backupCodes;
    };
    return { twoFactor, repository, clock, notices, warnings, codeOf, advance, enabled };
}

describe('二段階認証の設定', () => {
    it('始めると鍵（base32）と QR の URI を返し、DB には暗号化した鍵だけを置く。まだ有効ではない', async () => {
        const t = setup();
        const outcome = await t.twoFactor.beginSetup('alice');
        if (!outcome.ok) throw new Error(outcome.error);
        expect(outcome.value.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(outcome.value.uri).toContain(`secret=${outcome.value.secret}`);
        expect(outcome.value.uri).toContain('%40alice%40ubi.example');
        expect(t.repository.rows.get('alice')?.secret).not.toContain(outcome.value.secret);
        expect(await t.twoFactor.status('alice')).toEqual({ enabled: false, backupCodesLeft: 0 });
        expect(await t.twoFactor.isEnabled('alice')).toBe(false);
    });

    it('認証アプリのコードで確かめて有効にし、バックアップコード 10 個を 1 回だけ返す。知らせる', async () => {
        const t = setup();
        await t.twoFactor.beginSetup('alice');
        expect(await t.twoFactor.enable('alice', '000000')).toMatchObject({ ok: false, status: 400 });
        const outcome = await t.twoFactor.enable('alice', t.codeOf('alice'));
        if (!outcome.ok) throw new Error(outcome.error);
        expect(outcome.value.backupCodes).toHaveLength(10);
        expect(await t.twoFactor.status('alice')).toEqual({ enabled: true, backupCodesLeft: 10 });
        // DB にはバックアップコードの平文を置かない
        const stored = t.repository.rows.get('alice')?.backupCodeHashes ?? [];
        expect(stored.some((h) => outcome.value.backupCodes.some((c) => h.includes(c.replace('-', ''))))).toBe(false);
        expect(t.notices.map((n) => n.subject)).toEqual(['二段階認証を有効にしました']);
    });

    it('有効にした後は、始め直し・有効化のやり直しで鍵を差し替えさせない', async () => {
        const t = setup();
        await t.enabled('alice');
        const secret = t.repository.rows.get('alice')?.secret;
        expect(await t.twoFactor.beginSetup('alice')).toMatchObject({ ok: false, status: 409 });
        expect(await t.twoFactor.enable('alice', t.codeOf('alice'))).toMatchObject({ ok: false, status: 409 });
        expect(t.repository.rows.get('alice')?.secret).toBe(secret);
    });

    it('始めていなければ有効にできない。いないユーザーは始められない', async () => {
        const t = setup();
        expect(await t.twoFactor.enable('alice', '123456')).toMatchObject({ ok: false, status: 404 });
        expect(await t.twoFactor.beginSetup('ghost')).toMatchObject({ ok: false, status: 404 });
    });

    it('設定の途中で始め直すと前の鍵は使えない', async () => {
        const t = setup();
        await t.twoFactor.beginSetup('alice');
        const oldCode = t.codeOf('alice');
        await t.twoFactor.beginSetup('alice');
        const newCode = t.codeOf('alice');
        if (oldCode !== newCode) {
            expect(await t.twoFactor.enable('alice', oldCode)).toMatchObject({ ok: false, status: 400 });
        }
        expect(await t.twoFactor.enable('alice', newCode)).toMatchObject({ ok: true });
    });
});

describe('ログインの二段階目のコード', () => {
    it('認証アプリのコードは通り、同じコードの 2 回目は通さない', async () => {
        const t = setup();
        await t.enabled('alice');
        const code = t.codeOf('alice');
        expect(await t.twoFactor.verifyForSignIn('alice', code)).toEqual({
            ok: true,
            via: 'totp',
            backupCodesLeft: 10,
        });
        expect(await t.twoFactor.verifyForSignIn('alice', code)).toEqual({ ok: false, reason: 'invalid-code' });
        // 空白を挟んだ入力も受け付ける
        t.advance(30_000);
        const spaced = t.codeOf('alice');
        expect(await t.twoFactor.verifyForSignIn('alice', `${spaced.slice(0, 3)} ${spaced.slice(3)}`)).toMatchObject({
            ok: true,
        });
    });

    it('バックアップコードは 1 回ずつ使え、使ったら残りを知らせる。大文字・ハイフンなしも受け付ける', async () => {
        const t = setup();
        const [first = '', second = ''] = await t.enabled('alice');
        expect(await t.twoFactor.verifyForSignIn('alice', first)).toEqual({
            ok: true,
            via: 'backup-code',
            backupCodesLeft: 9,
        });
        expect(await t.twoFactor.verifyForSignIn('alice', first)).toEqual({ ok: false, reason: 'invalid-code' });
        expect(await t.twoFactor.verifyForSignIn('alice', second.replace('-', '').toUpperCase())).toMatchObject({
            ok: true,
            backupCodesLeft: 8,
        });
        expect(t.notices.map((n) => n.text).join('\n')).toContain('残りは 8 個');
        expect(await t.twoFactor.status('alice')).toEqual({ enabled: true, backupCodesLeft: 8 });
    });

    it('ほかのユーザーのバックアップコードは使えない', async () => {
        const t = setup();
        const [bobCode = ''] = await t.enabled('bob');
        await t.enabled('alice');
        expect(await t.twoFactor.verifyForSignIn('alice', bobCode)).toEqual({ ok: false, reason: 'invalid-code' });
    });

    it('続けて 10 回間違えると 15 分止め（正しいコードも通さない）、1 回だけ知らせる。時間が経てば通る', async () => {
        const t = setup();
        await t.enabled('alice');
        const results = await Promise.all(
            Array.from({ length: TWO_FACTOR_LIMITS.maxFailures }, () => t.twoFactor.verifyForSignIn('alice', '000000')),
        );
        expect(results.filter((r) => !r.ok && r.reason === 'locked')).toHaveLength(1);
        expect(await t.twoFactor.verifyForSignIn('alice', t.codeOf('alice'))).toEqual({ ok: false, reason: 'locked' });
        expect(await t.twoFactor.disable('alice', t.codeOf('alice'))).toMatchObject({ ok: false, status: 429 });
        expect(t.notices.filter((n) => n.subject.includes('続けて間違えられました'))).toHaveLength(1);

        t.advance(TWO_FACTOR_LIMITS.lockMs + 1);
        expect(await t.twoFactor.verifyForSignIn('alice', t.codeOf('alice'))).toMatchObject({ ok: true });
    });

    it('間違えた回数は成功で 0 に戻る（続けて間違えたときだけ止める）', async () => {
        const t = setup();
        await t.enabled('alice');
        const wrong = (n: number) =>
            Promise.all(Array.from({ length: n }, () => t.twoFactor.verifyForSignIn('alice', '000000')));
        await wrong(TWO_FACTOR_LIMITS.maxFailures - 1);
        expect(await t.twoFactor.verifyForSignIn('alice', t.codeOf('alice'))).toMatchObject({ ok: true });
        const after = await wrong(TWO_FACTOR_LIMITS.maxFailures - 1);
        expect(after.every((r) => !r.ok && r.reason === 'invalid-code')).toBe(true);
    });

    it('有効でないユーザー・文字列でない入力は通さない', async () => {
        const t = setup();
        expect(await t.twoFactor.verifyForSignIn('nobody', '123456')).toEqual({ ok: false, reason: 'not-enabled' });
        await t.enabled('alice');
        for (const input of [undefined, null, 123456, ['123456'], { code: '123456' }]) {
            expect(await t.twoFactor.verifyForSignIn('alice', input)).toEqual({ ok: false, reason: 'invalid-code' });
        }
    });

    it('鍵を開けない（サーバーの秘密が変わった）ときは通さず、ログに残す', async () => {
        const t = setup();
        await t.enabled('alice');
        const code = t.codeOf('alice');
        const row = t.repository.rows.get('alice');
        if (row) t.repository.rows.set('alice', { ...row, secret: 'v1.broken.broken.broken' });
        expect(await t.twoFactor.verifyForSignIn('alice', code)).toEqual({ ok: false, reason: 'invalid-code' });
        expect(t.warnings).toHaveLength(1);
    });
});

describe('無効にする・バックアップコードを作り直す', () => {
    it('無効にするには今のコードが要る（間違えれば有効のまま）。無効にしたら知らせる', async () => {
        const t = setup();
        const [backup = ''] = await t.enabled('alice');
        expect(await t.twoFactor.disable('alice', '000000')).toMatchObject({ ok: false, status: 400 });
        expect(await t.twoFactor.disable('alice', '')).toMatchObject({ ok: false, status: 400 });
        expect(await t.twoFactor.isEnabled('alice')).toBe(true);
        // 認証アプリを無くしても、バックアップコードで無効にできる
        expect(await t.twoFactor.disable('alice', backup)).toEqual({ ok: true, value: null });
        expect(await t.twoFactor.status('alice')).toEqual({ enabled: false, backupCodesLeft: 0 });
        expect(t.notices.map((n) => n.subject)).toEqual(['二段階認証を無効にしました']);
        expect(await t.twoFactor.disable('alice', '123456')).toMatchObject({ ok: false, status: 409 });
    });

    it('作り直すと前のバックアップコードは使えず、新しいものが使える', async () => {
        const t = setup();
        const [oldCode = ''] = await t.enabled('alice');
        expect(await t.twoFactor.regenerateBackupCodes('alice', '000000')).toMatchObject({ ok: false, status: 400 });
        const outcome = await t.twoFactor.regenerateBackupCodes('alice', t.codeOf('alice'));
        if (!outcome.ok) throw new Error(outcome.error);
        expect(outcome.value.backupCodes).toHaveLength(10);
        expect(await t.twoFactor.verifyForSignIn('alice', oldCode)).toMatchObject({ ok: false });
        expect(await t.twoFactor.verifyForSignIn('alice', outcome.value.backupCodes[0])).toMatchObject({ ok: true });
        expect(t.notices.map((n) => n.subject)).toContain('バックアップコードを作り直しました');
    });
});
