import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { registrationSignInPlugin } from './registrationSignInPlugin';

const BASE = 'https://ubi.example';
const json = { 'Content-Type': 'application/json', Origin: BASE };

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
        plugins: [
            registrationSignInPlugin({
                gate: {
                    required: async () => false,
                    issue: async () => 'challenge-token',
                    complete: async () => ({ ok: false, error: 'challenge-expired', message: 'x' }),
                },
            }),
        ],
    });
    const signUp = async () => {
        const res = await auth.handler(
            new Request(`${BASE}/api/auth/sign-up/email`, {
                method: 'POST',
                headers: json,
                body: JSON.stringify({ email: 'alice@example.com', password: 'password-123', name: 'alice' }),
            }),
        );
        db.session.length = 0;
        return ((await res.json()) as { user: { id: string } }).user.id;
    };
    return { auth, db, signUp };
}

describe('registrationSignInPlugin', () => {
    it('サーバーの中から呼ぶと、そのユーザーのセッションを作ってクッキーを返す', async () => {
        const t = setup();
        const userId = await t.signUp();
        const { headers, response } = await t.auth.api.registrationSignIn({
            body: { userId },
            headers: new Headers(),
            returnHeaders: true,
        });
        expect(response).toEqual({ signedIn: true });
        expect(headers.getSetCookie().some((cookie) => cookie.includes('better-auth.session_token='))).toBe(true);
        expect(t.db.session).toHaveLength(1);
        expect(t.db.session[0]).toMatchObject({ userId });
    });

    it('HTTP からは呼べない', async () => {
        const t = setup();
        const userId = await t.signUp();
        const res = await t.auth.handler(
            new Request(`${BASE}/api/auth/registration/sign-in`, {
                method: 'POST',
                headers: json,
                body: JSON.stringify({ userId }),
            }),
        );
        expect(res.status).toBe(404);
        expect(t.db.session).toHaveLength(0);
    });
});
