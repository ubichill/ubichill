import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import type { CallbackOutcome, FediverseSignIn } from '../services/auth/fediverse/signIn';
import { fediverseSignInPlugin } from './fediverseSignInPlugin';

const BASE = 'https://ubi.example';

function setup(callbackOutcome: CallbackOutcome) {
    const seen: { browserToken?: string | null; ticket?: string | null; sessionId?: string | null } = {};
    const signIn: FediverseSignIn = {
        clientDocument: (host) => (host === 'mi.example' ? '<!doctype html><link rel="redirect_uri" href="x">' : null),
        start: async () => ({ ok: true, authorizationUrl: 'https://mi.example/oauth/authorize?x', browserToken: 'B1' }),
        callback: async (input) => {
            seen.browserToken = input.browserToken;
            seen.sessionId = input.sessionId;
            return callbackOutcome;
        },
        signUpCandidate: async (ticket) => {
            seen.ticket = ticket;
            return ticket ? { server: 'mi.example', username: 'alice', handle: 'alice', displayName: 'Alice' } : null;
        },
        signUp: async ({ ticket }) =>
            ticket === 'T1'
                ? { ok: true, userId: 'u1', returnTo: '/@bob/room' }
                : { ok: false, status: 404, error: 'expired' },
    };
    const db = {
        user: [
            {
                id: 'u1',
                name: 'Alice',
                email: 'x@sso.invalid',
                emailVerified: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ],
        session: [] as Array<Record<string, unknown>>,
        account: [],
        verification: [],
    };
    const auth = betterAuth({
        baseURL: BASE,
        secret: 'test-secret-test-secret-test-secret-32',
        database: memoryAdapter(db),
        trustedOrigins: [BASE],
        // テスト環境では better-auth が origin の確認を既定で止めるので、本番と同じく有効にする
        advanced: { disableOriginCheck: false, disableCSRFCheck: false },
        plugins: [
            fediverseSignInPlugin({
                getSignIn: async () => signIn,
                options: () => ({ enabled: true, registrationOpen: true }),
            }),
        ],
    });
    const request = (path: string, init: RequestInit = {}) =>
        auth.handler(new Request(`${BASE}/api/auth${path}`, init));
    return { request, seen, db };
}

/** Set-Cookie から「名前=値」を取り出して、次の要求の Cookie にする */
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0] ?? '');
const findCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.includes(`${name}=`));

describe('fediverseSignInPlugin', () => {
    const start = async (t: ReturnType<typeof setup>) =>
        t.request('/fediverse/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: BASE },
            body: JSON.stringify({ server: 'mi.example', returnTo: '/@bob/room' }),
        });

    it('開始すると認可 URL を返し、ブラウザーの印を /api/auth/fediverse だけの httpOnly クッキーに入れる', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: `${BASE}/auth` });
        const res = await start(t);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ url: 'https://mi.example/oauth/authorize?x' });
        const flow = findCookie(res, 'fediverse_flow') ?? '';
        expect(flow).toMatch(/HttpOnly/i);
        expect(flow).toMatch(/SameSite=Lax/i);
        expect(flow).toMatch(/Path=\/api\/auth\/fediverse/);
        expect(flow).toMatch(/Secure/);
        // 署名付き（値そのままではない）
        expect(flow).not.toMatch(/fediverse_flow=B1;/);
    });

    it('応答では署名を確かめた印を渡し、連携済みならセッションを発行して戻す', async () => {
        const t = setup({ kind: 'signed-in', userId: 'u1', redirectTo: `${BASE}/@bob/room` });
        const started = await start(t);
        const res = await t.request('/fediverse/callback/mi.example?code=c&state=s', {
            headers: { Cookie: cookiesOf(started).join('; ') },
        });
        expect(t.seen.browserToken).toBe('B1');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe(`${BASE}/@bob/room`);
        expect(findCookie(res, 'session_token')).toBeDefined();
        expect(findCookie(res, 'fediverse_flow')).toMatch(/Max-Age=0/);
        expect(t.db.session).toHaveLength(1);
    });

    it('改ざんした印は渡さない', async () => {
        const t = setup({ kind: 'error', error: 'mismatch', redirectTo: `${BASE}/auth?fediverse_error=mismatch` });
        const res = await t.request('/fediverse/callback/mi.example?code=c&state=s', {
            headers: { Cookie: '__Secure-better-auth.fediverse_flow=B1.forged' },
        });
        expect(t.seen.browserToken).toBeNull();
        expect(res.status).toBe(302);
        expect(findCookie(res, 'session_token')).toBeUndefined();
    });

    it('初回は登録の鍵をクッキーに入れ、候補の取得と登録でそれを使ってセッションを発行する', async () => {
        const t = setup({ kind: 'sign-up', ticket: 'T1', redirectTo: `${BASE}/auth?fediverse=sign-up` });
        const callback = await t.request('/fediverse/callback/mi.example?code=c&state=s');
        expect(callback.headers.get('location')).toBe(`${BASE}/auth?fediverse=sign-up`);
        expect(findCookie(callback, 'session_token')).toBeUndefined();
        const cookie = cookiesOf(callback).join('; ');

        const candidate = await t.request('/fediverse/sign-up', { headers: { Cookie: cookie } });
        expect(await candidate.json()).toMatchObject({ handle: 'alice' });
        expect(t.seen.ticket).toBe('T1');

        const signUp = await t.request('/fediverse/sign-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
            body: JSON.stringify({ handle: 'alice', displayName: 'Alice' }),
        });
        expect(signUp.status).toBe(200);
        expect(await signUp.json()).toEqual({ returnTo: '/@bob/room' });
        expect(findCookie(signUp, 'session_token')).toBeDefined();
        expect(findCookie(signUp, 'fediverse_sign_up')).toMatch(/Max-Age=0/);
    });

    it('登録の鍵が無ければ候補も登録も 404', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        expect((await t.request('/fediverse/sign-up')).status).toBe(404);
        const res = await t.request('/fediverse/sign-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: BASE },
            body: JSON.stringify({ handle: 'alice', displayName: 'Alice' }),
        });
        expect(res.status).toBe(404);
    });

    it('信頼しない Origin からの開始は better-auth の origin 確認で断る', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        const res = await t.request('/fediverse/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: 'x=1' },
            body: JSON.stringify({ server: 'mi.example' }),
        });
        expect(res.status).toBe(403);
    });

    it('Misskey の client_id の文書を HTML で返し、知らないホストは 404', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        const ok = await t.request('/fediverse/client/mi.example');
        expect(ok.headers.get('content-type')).toMatch(/text\/html/);
        expect(await ok.text()).toContain('redirect_uri');
        expect((await t.request('/fediverse/client/other.example')).status).toBe(404);
    });
});
