import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { multiSession } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { accountSwitchPlugin } from './accountSwitchPlugin';

const BASE = 'https://ubi.example';

function setup() {
    const db = {
        user: [] as Array<Record<string, unknown>>,
        session: [] as Array<Record<string, unknown>>,
        account: [] as Array<Record<string, unknown>>,
        verification: [] as Array<Record<string, unknown>>,
    };
    const auth = betterAuth({
        baseURL: BASE,
        secret: 'test-secret-test-secret-test-secret-32',
        database: memoryAdapter(db),
        trustedOrigins: [BASE],
        emailAndPassword: { enabled: true },
        advanced: { disableOriginCheck: false, disableCSRFCheck: false },
        plugins: [multiSession({ maximumSessions: 5 }), accountSwitchPlugin()],
    });
    // ブラウザーのクッキー入れ（Set-Cookie を反映し、Max-Age=0 は消す）
    const jar = new Map<string, string>();
    const request = async (path: string, init: RequestInit = {}) => {
        const res = await auth.handler(
            new Request(`${BASE}/api/auth${path}`, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    Origin: BASE,
                    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
                    ...init.headers,
                },
            }),
        );
        for (const c of res.headers.getSetCookie()) {
            const [kv = ''] = c.split(';');
            const i = kv.indexOf('=');
            if (/Max-Age=0/i.test(c) || kv.slice(i + 1) === '') jar.delete(kv.slice(0, i));
            else jar.set(kv.slice(0, i), kv.slice(i + 1));
        }
        return res;
    };
    const signUp = (email: string, name: string) =>
        request('/sign-up/email', { method: 'POST', body: JSON.stringify({ email, password: 'password-123', name }) });
    const list = async () =>
        ((await (await request('/account-switch/accounts')).json()) as { accounts: Array<Record<string, unknown>> })
            .accounts;
    return { request, signUp, list, db, jar };
}

describe('accountSwitchPlugin', () => {
    it('このブラウザーでログインしたアカウントを並べ、今のアカウントに印を付ける。トークンは返さない', async () => {
        const t = setup();
        await t.signUp('a@example.com', 'A');
        await t.signUp('b@example.com', 'B');
        const res = await t.request('/account-switch/accounts');
        const text = await res.clone().text();
        const accounts = ((await res.json()) as { accounts: Array<{ name: string; active: boolean }> }).accounts;
        expect(accounts.map((a) => [a.name, a.active]).sort()).toEqual([
            ['A', false],
            ['B', true],
        ]);
        for (const s of t.db.session) expect(text).not.toContain(String(s.token));
    });

    it('別のアカウントに切り替え、戻ってこられる', async () => {
        const t = setup();
        await t.signUp('a@example.com', 'A');
        await t.signUp('b@example.com', 'B');
        const a = (await t.list()).find((x) => x.name === 'A');
        const switched = await t.request('/account-switch/switch', {
            method: 'POST',
            body: JSON.stringify({ userId: a?.userId }),
        });
        expect(switched.status).toBe(200);
        const session = (await (await t.request('/get-session')).json()) as { user: { name: string } };
        expect(session.user.name).toBe('A');
        expect((await t.list()).find((x) => x.active)?.name).toBe('A');
    });

    it('覚えていないユーザーには切り替えられない', async () => {
        const t = setup();
        await t.signUp('a@example.com', 'A');
        const res = await t.request('/account-switch/switch', {
            method: 'POST',
            body: JSON.stringify({ userId: 'someone-else' }),
        });
        expect(res.status).toBe(404);
    });

    it('このアカウントだけログアウトし、ほかのアカウントに切り替わる。最後の 1 つならログアウトする', async () => {
        const t = setup();
        await t.signUp('a@example.com', 'A');
        await t.signUp('b@example.com', 'B');
        const first = (await (await t.request('/account-switch/sign-out', { method: 'POST' })).json()) as {
            next: string | null;
        };
        expect(first.next).not.toBeNull();
        const session = (await (await t.request('/get-session')).json()) as { user: { name: string } };
        expect(session.user.name).toBe('A');
        // B のセッションは DB からも消えている
        expect(t.db.session).toHaveLength(1);
        const last = (await (await t.request('/account-switch/sign-out', { method: 'POST' })).json()) as {
            next: string | null;
        };
        expect(last.next).toBeNull();
        expect(await (await t.request('/get-session')).json()).toBeNull();
        expect(t.db.session).toHaveLength(0);
    });

    it('信頼しない Origin からの切り替えは断る', async () => {
        const t = setup();
        await t.signUp('a@example.com', 'A');
        const res = await t.request('/account-switch/switch', {
            method: 'POST',
            headers: { Origin: 'https://evil.example' },
            body: JSON.stringify({ userId: 'x' }),
        });
        expect(res.status).toBe(403);
    });
});
