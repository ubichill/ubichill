import type { EmailLinkRecord, LinkEmailOutcome } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { createEmailLinks, type EmailLinkDeps } from './emailLinks';
import { createOtpHasher } from './pendingRegistrations';

/** Postgres の代わり。行ロックの中の変更は、投げたら戻す。 */
function setup(overrides: Partial<EmailLinkDeps> = {}) {
    const rows = new Map<string, EmailLinkRecord>();
    const users = new Map([
        ['sso', { email: 'abc@sso.invalid', hasPassword: false }],
        ['sso2', { email: 'def@sso.invalid', hasPassword: false }],
        ['mail', { email: 'mail@example.com', hasPassword: true }],
    ]);
    const linked: Array<{ userId: string; email: string; passwordHash: string }> = [];
    const sent: Array<{ to: string; otp: string }> = [];
    const after: string[] = [];
    const state = { otp: 100000, linkResult: null as LinkEmailOutcome | null, failMail: false, now: 0 };

    const deps: EmailLinkDeps = {
        repository: {
            put: async (record) => {
                rows.set(record.userId, { ...record, failures: 0 });
            },
            withLocked: async (userId, fn) => {
                const before = new Map(rows);
                try {
                    return await fn(rows.get(userId), {
                        remove: async () => {
                            rows.delete(userId);
                        },
                        setFailures: async (failures) => {
                            const row = rows.get(userId);
                            if (row) rows.set(userId, { ...row, failures });
                        },
                        link: async (input) => {
                            if (state.linkResult) return state.linkResult;
                            linked.push({ userId, email: input.email, passwordHash: input.passwordHash });
                            return 'linked';
                        },
                    });
                } catch (error) {
                    rows.clear();
                    for (const [k, v] of before) rows.set(k, v);
                    throw error;
                }
            },
        },
        user: async (userId) => users.get(userId),
        emailInUse: async (email) => [...users.values()].some((u) => u.email === email),
        password: { hash: async (password) => `hashed:${password}`, minLength: 8, maxLength: 128 },
        newOtp: () => String(++state.otp),
        hashOtp: createOtpHasher('test-secret'),
        newAccountId: () => 'acc-new',
        sendCode: async (to, otp) => {
            if (state.failMail) throw new Error('mail down');
            sent.push({ to, otp });
        },
        afterLinked: async (userId, sessionId) => {
            after.push(`${userId} ${sessionId}`);
        },
        skipVerification: false,
        now: () => new Date(state.now),
        ...overrides,
    };
    const links = createEmailLinks(deps);
    const start = (userId: string, email: unknown = 'Me@Example.org', password: unknown = 'password-123') =>
        links.start({ userId, sessionId: `s-${userId}`, email, password });
    const verify = (userId: string, code: unknown) => links.verify({ userId, sessionId: `s-${userId}`, code });
    const lastCode = () => sent.at(-1)?.otp ?? '';
    return { links, start, verify, lastCode, rows, linked, sent, after, state };
}

describe('メールアドレスの追加', () => {
    it('コードを送り、正しいコードでアドレス（小文字）とパスワードを足す。セッションはパスワードで確かめた扱いにする', async () => {
        const t = setup();
        expect(await t.start('sso')).toEqual({ ok: true, status: 'sent' });
        expect(t.sent).toEqual([{ to: 'me@example.org', otp: t.lastCode() }]);
        // コードとパスワードの平文は保存しない
        const row = t.rows.get('sso');
        expect(JSON.stringify(row)).not.toContain(t.lastCode());
        expect(row?.passwordHash).toBe('hashed:password-123');
        expect(await t.verify('sso', ` ${t.lastCode()} `)).toEqual({ ok: true, status: 'linked' });
        expect(t.linked).toEqual([{ userId: 'sso', email: 'me@example.org', passwordHash: 'hashed:password-123' }]);
        expect(t.after).toEqual(['sso s-sso']);
        expect(t.rows.size).toBe(0);
        // 同じコードは 2 度使えない
        expect(await t.verify('sso', t.lastCode())).toMatchObject({ ok: false, status: 404 });
    });

    it('形式の違うアドレス・内部値と紛れるアドレス・短いパスワードは受け付けない（コードも送らない）', async () => {
        const t = setup();
        for (const email of ['not-an-email', 'x@sso.invalid', 'a@b.invalid', '', 42, null]) {
            expect(await t.start('sso', email)).toMatchObject({ ok: false, status: 400 });
        }
        for (const password of ['short', '', 'x'.repeat(129), null]) {
            expect(await t.start('sso', 'me@example.org', password)).toMatchObject({ ok: false, status: 400 });
        }
        expect(t.sent).toEqual([]);
        expect(t.rows.size).toBe(0);
    });

    it('既にメールアドレスかパスワードがある人・ほかの人が使っているアドレスは 409', async () => {
        const t = setup();
        expect(await t.start('mail')).toMatchObject({ ok: false, status: 409 });
        expect(await t.start('sso', 'MAIL@example.com')).toMatchObject({ ok: false, status: 409 });
        expect(t.sent).toEqual([]);
    });

    it('ほかの人のコードは自分の申し込みに使えない', async () => {
        const t = setup();
        await t.start('sso', 'a@example.org');
        const others = t.lastCode();
        await t.start('sso2', 'b@example.org');
        expect(await t.verify('sso2', others)).toMatchObject({ ok: false, status: 400 });
        expect(t.linked).toEqual([]);
    });

    it('コードを決められた回数間違えたら取り消し、その後は正しいコードでも足せない', async () => {
        const t = setup();
        await t.start('sso');
        const code = t.lastCode();
        for (let i = 0; i < 4; i++) expect(await t.verify('sso', '000000')).toMatchObject({ status: 400 });
        expect(t.rows.get('sso')?.failures).toBe(4);
        expect(await t.verify('sso', '000000')).toMatchObject({ error: expect.stringContaining('取り消しました') });
        expect(await t.verify('sso', code)).toMatchObject({ ok: false, status: 404 });
        expect(t.linked).toEqual([]);
    });

    it('送り直すと前のコードは使えず、間違えた回数も戻る', async () => {
        const t = setup();
        await t.start('sso');
        const first = t.lastCode();
        await t.verify('sso', '000000');
        await t.start('sso', 'other@example.org');
        expect(t.rows.get('sso')?.failures).toBe(0);
        expect(await t.verify('sso', first)).toMatchObject({ ok: false, status: 400 });
        expect(await t.verify('sso', t.lastCode())).toEqual({ ok: true, status: 'linked' });
        expect(t.linked[0]?.email).toBe('other@example.org');
    });

    it('期限を過ぎたコードは使えず、申し込みも消える', async () => {
        const t = setup();
        await t.start('sso');
        t.state.now = 10 * 60 * 1000;
        expect(await t.verify('sso', t.lastCode())).toMatchObject({ ok: false, status: 400 });
        expect(t.rows.size).toBe(0);
    });

    it('コードを送った後に同じアドレスで別の人が登録していたら、足さずに 409（申し込みは消す）', async () => {
        const t = setup();
        await t.start('sso');
        t.state.linkResult = 'email-taken';
        expect(await t.verify('sso', t.lastCode())).toMatchObject({ ok: false, status: 409 });
        expect(t.after).toEqual([]);
        expect(t.rows.size).toBe(0);
    });

    it('メールを送れなければ 503 で、申し込みを残さない', async () => {
        const t = setup();
        t.state.failMail = true;
        expect(await t.start('sso')).toMatchObject({ ok: false, status: 503 });
        expect(t.rows.size).toBe(0);
    });

    it('メール確認を省く環境では、コードを送らずにすぐ足す', async () => {
        const t = setup({ skipVerification: true });
        expect(await t.start('sso')).toEqual({ ok: true, status: 'linked' });
        expect(t.sent).toEqual([]);
        expect(t.linked).toHaveLength(1);
        expect(t.after).toEqual(['sso s-sso']);
    });
});
