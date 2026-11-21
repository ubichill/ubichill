import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { createSignInEmailResolver } from '../services/auth/signInEmail';
import { signInIdentifierPlugin } from './signInIdentifierPlugin';
import { twoFactorPlugin } from './twoFactorPlugin';

const BASE = 'https://ubi.example';
const json = { 'Content-Type': 'application/json', Origin: BASE };

function setup(twoFactorUsers: string[] = []) {
    const db = {
        user: [] as Array<Record<string, unknown>>,
        session: [] as Array<Record<string, unknown>>,
        account: [] as Array<Record<string, unknown>>,
        verification: [] as Array<Record<string, unknown>>,
    };
    const handles = new Map<string, string>();
    const auth = betterAuth({
        baseURL: BASE,
        secret: 'test-secret-test-secret-test-secret-32',
        database: memoryAdapter(db),
        trustedOrigins: [BASE],
        emailAndPassword: { enabled: true },
        // 本番（lib/auth.ts）と同じ順番（ID の置き換えは before、二段階認証は after）
        plugins: [
            signInIdentifierPlugin({
                resolveEmail: createSignInEmailResolver({
                    findEmailByHandle: async (handle) => handles.get(handle) ?? null,
                }),
            }),
            twoFactorPlugin({
                gate: {
                    required: async (userId) => twoFactorUsers.includes(userId),
                    issue: async () => 'challenge-token',
                    complete: async () => ({ ok: false, error: 'challenge-expired', message: 'x' }),
                },
            }),
        ],
    });
    const request = (path: string, body: unknown) =>
        auth.handler(
            new Request(`${BASE}/api/auth${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) }),
        );
    const signUp = async (handle: string, email: string) => {
        const res = await request('/sign-up/email', { email, password: 'password-123', name: handle });
        const { user } = (await res.json()) as { user: { id: string } };
        handles.set(handle, email);
        db.session.length = 0;
        return user.id;
    };
    return { request, signUp, db };
}

describe('signInIdentifierPlugin', () => {
    it('ID でも、メールアドレスでもログインできる', async () => {
        const t = setup();
        await t.signUp('alice', 'alice@example.com');
        for (const email of ['alice', '@Alice', 'alice@example.com']) {
            const res = await t.request('/sign-in/email', { email, password: 'password-123' });
            expect(res.status, email).toBe(200);
            expect(((await res.json()) as { user: { email: string } }).user.email).toBe('alice@example.com');
        }
    });

    it('いない ID・違うパスワードは、メールアドレスのときと同じ失敗（ID があるかを明かさない）', async () => {
        const t = setup();
        await t.signUp('alice', 'alice@example.com');
        const failures = await Promise.all(
            [
                { email: 'nobody', password: 'password-123' },
                { email: 'alice', password: 'wrong-password' },
                { email: 'nobody@example.com', password: 'password-123' },
            ].map(async (body) => {
                const res = await t.request('/sign-in/email', body);
                return { status: res.status, code: ((await res.json()) as { code?: string }).code };
            }),
        );
        expect(failures).toEqual(Array(3).fill({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }));
        expect(t.db.session).toHaveLength(0);
    });

    it('ID で入っても、二段階認証が有効ならセッションを作らずにコードを求める', async () => {
        const users: string[] = [];
        const t = setup(users);
        users.push(await t.signUp('bob', 'bob@example.com'));
        const res = await t.request('/sign-in/email', { email: 'bob', password: 'password-123' });
        expect(await res.json()).toEqual({ twoFactorRequired: true });
        expect(t.db.session).toHaveLength(0);
    });
});
