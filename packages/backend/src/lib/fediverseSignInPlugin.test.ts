import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import type { CallbackOutcome, FediverseSignIn } from '../services/auth/fediverse/signIn';
import { fediverseSignInPlugin } from './fediverseSignInPlugin';
import { sessionAssuranceFields, sessionAssuranceHooks } from './sessionAssuranceOptions';

const BASE = 'https://ubi.example';

function setup(callbackOutcome: CallbackOutcome) {
    const seen: {
        browserToken?: string | null;
        ticket?: string | null;
        sessionId?: string | null;
        cancelled?: string | null;
        started?: number;
        startSession?: Parameters<FediverseSignIn['start']>[0]['session'];
    } = { started: 0 };
    const signIn: FediverseSignIn = {
        lookup: async (input) =>
            input === 'mi.example'
                ? { ok: true, server: { host: 'mi.example', software: 'misskey', name: 'Mi', iconUrl: null } }
                : { ok: false, error: 'unsupported-server' },
        cancelSignUp: async (ticket) => {
            seen.cancelled = ticket;
        },
        start: async (input) => {
            seen.started = (seen.started ?? 0) + 1;
            seen.startSession = input.session;
            return { ok: true, authorizationUrl: 'https://mi.example/oauth/authorize?x', browserToken: 'B1' };
        },
        callback: async (input) => {
            seen.browserToken = input.browserToken;
            seen.sessionId = input.sessionId;
            return callbackOutcome;
        },
        signUpCandidate: async (ticket) => {
            seen.ticket = ticket;
            return ticket
                ? {
                      server: 'mi.example',
                      username: 'alice',
                      handle: 'alice',
                      displayName: 'Alice',
                      avatarUrl: null,
                      notRegistered: false,
                      registrationOpen: true,
                  }
                : null;
        },
        signUp: async ({ ticket }) =>
            ticket === 'T1'
                ? { ok: true, userId: 'u1', accountRowId: 'acc-1', returnTo: '/@bob/room' }
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
        account: [] as Array<Record<string, unknown>>,
        verification: [] as Array<Record<string, unknown>>,
    };
    const auth = betterAuth({
        baseURL: BASE,
        secret: 'test-secret-test-secret-test-secret-32',
        database: memoryAdapter(db),
        trustedOrigins: [BASE],
        emailAndPassword: { enabled: true },
        session: { additionalFields: sessionAssuranceFields },
        databaseHooks: sessionAssuranceHooks,
        // テスト環境では better-auth が origin の確認を既定で止めるので、本番と同じく有効にする
        advanced: { disableOriginCheck: false, disableCSRFCheck: false },
        plugins: [
            fediverseSignInPlugin({
                getSignIn: async () => signIn,
                // 二段階認証の流れは twoFactorPlugin.test.ts
                secondFactor: {
                    required: async () => false,
                    issue: async () => 'unused',
                    complete: async () => ({ ok: false, error: 'challenge-expired', message: '' }),
                },
                options: async () => ({ enabled: true, registrationOpen: true, featuredServers: ['mi.example'] }),
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
        const t = setup({ kind: 'signed-in', userId: 'u1', accountRowId: 'acc-1', redirectTo: `${BASE}/@bob/room` });
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

    it('SSO で作ったセッションは外部アカウントを覚え、パスワードの印は付かない', async () => {
        const t = setup({ kind: 'signed-in', userId: 'u1', accountRowId: 'acc-1', redirectTo: `${BASE}/` });
        const started = await start(t);
        await t.request('/fediverse/callback/mi.example?code=c&state=s', {
            headers: { Cookie: cookiesOf(started).join('; ') },
        });
        expect(t.db.session).toHaveLength(1);
        expect(t.db.session[0]?.authAccountId).toBe('acc-1');
        expect(t.db.session[0]?.passwordVerifiedAt ?? null).toBeNull();
    });

    const passwordUser = async (t: ReturnType<typeof setup>) => {
        const json = { 'Content-Type': 'application/json', Origin: BASE };
        await t.request('/sign-up/email', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ email: 'pw@example.com', password: 'password-123', name: 'Pw' }),
        });
        t.db.session.length = 0;
        const signIn = await t.request('/sign-in/email', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ email: 'pw@example.com', password: 'password-123' }),
        });
        return cookiesOf(signIn).join('; ');
    };

    it('パスワードでログインしたセッションには印が付く', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        await passwordUser(t);
        expect(t.db.session).toHaveLength(1);
        expect(t.db.session[0]?.passwordVerifiedAt).toBeInstanceOf(Date);
        expect(t.db.session[0]?.authAccountId ?? null).toBeNull();
    });

    it('連携の開始はパスワードを入れ直さずにできる。ただし DB で取り消したセッションでは始められない', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        const cookie = await passwordUser(t);
        const link = () =>
            t.request('/fediverse/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
                body: JSON.stringify({ server: 'mi.example', intent: 'link' }),
            });
        // 何日も前のログイン・パスワードを確かめていないセッションでも始められる
        const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        Object.assign(t.db.session[0] ?? {}, { createdAt: old, passwordVerifiedAt: null });
        expect((await link()).status).toBe(200);
        expect(t.seen.startSession).toMatchObject({ sessionId: t.db.session[0]?.id });
        // 取り消したセッション（クッキーキャッシュは残っている）は、ログインしていない扱いで流れに渡す
        t.db.session.length = 0;
        await link();
        expect(t.seen.startSession).toBeNull();
    });

    it('登録をやめると鍵を消し、クッキーも消す', async () => {
        const t = setup({ kind: 'sign-up', ticket: 'T1', redirectTo: `${BASE}/auth?fediverse=sign-up` });
        const callback = await t.request('/fediverse/callback/mi.example?code=c&state=s');
        const res = await t.request('/fediverse/sign-up', {
            method: 'DELETE',
            headers: { Origin: BASE, Cookie: cookiesOf(callback).join('; ') },
        });
        expect(res.status).toBe(200);
        expect(t.seen.cancelled).toBe('T1');
        expect(findCookie(res, 'fediverse_sign_up')).toMatch(/Max-Age=0/);
    });

    it('lookup は公開情報か、理由のコードを返す', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        const ok = await t.request('/fediverse/lookup?server=mi.example');
        expect(await ok.json()).toEqual({ host: 'mi.example', software: 'misskey', name: 'Mi', iconUrl: null });
        const ng = await t.request('/fediverse/lookup?server=old.example');
        expect(ng.status).toBe(400);
        expect(await ng.json()).toMatchObject({ code: 'unsupported-server' });
        const options = await t.request('/fediverse/options');
        expect(await options.json()).toMatchObject({ featuredServers: ['mi.example'] });
    });

    it('MiAuth の戻り（session だけ）を受け付けて流れに渡す', async () => {
        const t = setup({ kind: 'signed-in', userId: 'u1', accountRowId: 'acc-1', redirectTo: `${BASE}/` });
        const started = await start(t);
        const res = await t.request('/fediverse/callback/mi.example?session=S1', {
            headers: { Cookie: cookiesOf(started).join('; ') },
        });
        expect(res.status).toBe(302);
        expect(t.seen.browserToken).toBe('B1');
    });

    it('Misskey の client_id の文書の口はもう無い', async () => {
        const t = setup({ kind: 'error', error: 'expired', redirectTo: BASE });
        expect((await t.request('/fediverse/client/mi.example')).status).toBe(404);
    });
});
