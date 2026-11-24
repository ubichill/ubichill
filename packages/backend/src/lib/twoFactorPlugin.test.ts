import type { TwoFactorChallengeRecord } from '@ubichill/db';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { multiSession } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import type { CallbackOutcome, FediverseSignIn } from '../services/auth/fediverse/signIn';
import { createTwoFactorChallenges } from '../services/auth/twoFactor/challenges';
import type { CodeCheck } from '../services/auth/twoFactor/twoFactor';
import { fediverseSignInPlugin } from './fediverseSignInPlugin';
import { sessionAssuranceFields, sessionAssuranceHooks } from './sessionAssuranceOptions';
import { type SecondFactorGate, twoFactorPlugin } from './twoFactorPlugin';

const BASE = 'https://ubi.example';
const json = { 'Content-Type': 'application/json', Origin: BASE };

/** 二段階目の判断（途中の状態は本物の手順をメモリーで、コードは 123456 だけ通す） */
function memoryGate(enabled: Set<string>) {
    const rows = new Map<string, TwoFactorChallengeRecord>();
    const verify = async (_userId: string, code: unknown): Promise<CodeCheck> =>
        code === '123456' ? { ok: true, via: 'totp', backupCodesLeft: 10 } : { ok: false, reason: 'invalid-code' };
    const challenges = createTwoFactorChallenges({
        repository: {
            create: async (record) => {
                rows.set(record.id, { ...record, attempts: 0 });
            },
            beginAttempt: async (id, now, max) => {
                const row = rows.get(id);
                if (!row || row.expiresAt <= now || row.attempts >= max) return undefined;
                row.attempts += 1;
                return { ...row };
            },
            consume: async (id, now) => {
                const row = rows.get(id);
                if (!row || row.expiresAt <= now) return undefined;
                rows.delete(id);
                return row;
            },
            remove: async (id) => {
                rows.delete(id);
            },
        },
        verify,
        newToken: () => crypto.randomUUID(),
        hashToken: (token) => `h:${token}`,
        now: () => new Date(),
        lockedError: 'locked',
    });
    const gate: SecondFactorGate = {
        required: async (userId) => enabled.has(userId),
        issue: (first) => challenges.issue(first),
        complete: (token, code) => challenges.complete(token, code),
    };
    return { gate, rows };
}

function fakeFediverse(outcome: CallbackOutcome): FediverseSignIn {
    return {
        lookup: async () => ({ ok: false, error: 'unsupported-server' }),
        cancelSignUp: async () => undefined,
        start: async () => ({ ok: true, authorizationUrl: 'https://mi.example/auth', browserToken: 'B1' }),
        callback: async () => outcome,
        signUpCandidate: async () => null,
        signUp: async () => ({ ok: true, userId: 'u-sso', accountRowId: 'acc-1', returnTo: '/@bob/room' }),
    };
}

function setup(options: { enabled?: string[]; callback?: CallbackOutcome } = {}) {
    const enabled = new Set(options.enabled ?? []);
    const { gate, rows } = memoryGate(enabled);
    const db = {
        user: [
            {
                id: 'u-sso',
                name: 'Sso',
                email: 'x@sso.invalid',
                emailVerified: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ] as Array<Record<string, unknown>>,
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
        session: { additionalFields: sessionAssuranceFields, cookieCache: { enabled: true, maxAge: 300 } },
        databaseHooks: sessionAssuranceHooks,
        advanced: { disableOriginCheck: false, disableCSRFCheck: false },
        // 本番（lib/auth.ts）と同じ順番
        plugins: [
            twoFactorPlugin({ gate }),
            multiSession({ maximumSessions: 5 }),
            fediverseSignInPlugin({
                getSignIn: async () =>
                    fakeFediverse(options.callback ?? { kind: 'error', error: 'expired', redirectTo: `${BASE}/` }),
                secondFactor: gate,
                options: async () => ({ enabled: true, registrationOpen: true, featuredServers: [] }),
                hasPassword: async () => false,
            }),
        ],
    });
    const request = (path: string, init: RequestInit = {}) =>
        auth.handler(new Request(`${BASE}/api/auth${path}`, init));
    return { auth, request, db, rows, enabled };
}

const cookiesOf = (res: Response) =>
    res.headers
        .getSetCookie()
        .filter((c) => !/Max-Age=0/i.test(c))
        .map((c) => c.split(';')[0] ?? '');
const findCookie = (res: Response, name: string) =>
    res.headers.getSetCookie().filter((c) => c.split('=')[0]?.includes(name));

const signUpWithPassword = async (t: ReturnType<typeof setup>, email: string) => {
    const res = await t.request('/sign-up/email', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'password-123', name: email }),
    });
    const { user } = (await res.json()) as { user: { id: string } };
    t.db.session.length = 0;
    return user.id;
};

const signIn = (t: ReturnType<typeof setup>, email: string, extra: Record<string, unknown> = {}) =>
    t.request('/sign-in/email', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'password-123', ...extra }),
    });

const verify = (t: ReturnType<typeof setup>, cookie: string, code: string) =>
    t.request('/two-factor/verify', {
        method: 'POST',
        headers: { ...json, Cookie: cookie },
        body: JSON.stringify({ code }),
    });

/** パスワードの利用者を、二段階認証を有効にした状態で用意する */
async function gatedPasswordUser() {
    const first = setup();
    const id = await signUpWithPassword(first, 'tf@example.com');
    const t = setup({ enabled: [id] });
    t.db.user.push(...first.db.user.filter((u) => u.id === id));
    t.db.account.push(...first.db.account);
    return { t, id };
}

describe('twoFactorPlugin（パスワードのログイン）', () => {
    it('二段階認証が無効なら、いつもどおりセッションを作る', async () => {
        const t = setup();
        await signUpWithPassword(t, 'plain@example.com');
        const res = await signIn(t, 'plain@example.com');
        expect(res.status).toBe(200);
        expect(t.db.session).toHaveLength(1);
        expect(findCookie(res, 'session_token').some((c) => !/Max-Age=0/i.test(c))).toBe(true);
    });

    it('有効なら、セッションを作らず（作ったものは消し、クッキーも返さず）二段階目を求める', async () => {
        const { t: gated, id } = await gatedPasswordUser();
        const res = await signIn(gated, 'tf@example.com');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ twoFactorRequired: true });
        expect(gated.db.session).toHaveLength(0);
        // 有効なセッションのクッキー（session_token・キャッシュ・このブラウザーのアカウント）を返さない
        const live = res.headers
            .getSetCookie()
            .filter((c) => !/Max-Age=0/i.test(c))
            .map((c) => c.split('=')[0]);
        expect(live.some((name) => /session_token|session_data|_multi-/.test(name ?? ''))).toBe(false);
        const challenge = findCookie(res, 'two_factor_challenge')[0] ?? '';
        expect(challenge).toMatch(/HttpOnly/i);
        expect(challenge).toMatch(/Path=\/api\/auth\/two-factor/);
        expect(gated.rows.size).toBe(1);
        expect([...gated.rows.values()][0]).toMatchObject({ userId: id, passwordVerified: true, authAccountId: null });
    });
});

describe('twoFactorPlugin（アカウントの追加）', () => {
    it('ログイン中に別のアカウントを足す途中で二段階目に進んでも、元のアカウントのログインはこのブラウザーに残る', async () => {
        const t = setup();
        const a = await signUpWithPassword(t, 'a@example.com');
        const b = await signUpWithPassword(t, 'b@example.com');
        t.enabled.add(b);
        const asA = await signIn(t, 'a@example.com');
        const cookieA = cookiesOf(asA).join('; ');

        const adding = await t.request('/sign-in/email', {
            method: 'POST',
            headers: { ...json, Cookie: cookieA },
            body: JSON.stringify({ email: 'b@example.com', password: 'password-123' }),
        });
        expect(await adding.json()).toEqual({ twoFactorRequired: true });
        // B のセッションは作らず、A のクッキーを戻す（ブラウザーと同じく、後の Set-Cookie で上書きし、期限切れは消す）
        const jar = adding.headers.getSetCookie().reduce(
            (cookies, header) => {
                const pair = header.split(';')[0] ?? '';
                const name = pair.split('=')[0] ?? '';
                const next = new Map(cookies);
                if (/Max-Age=0/i.test(header)) next.delete(name);
                else next.set(name, pair);
                return next;
            },
            new Map(cookieA.split('; ').map((c) => [c.split('=')[0] ?? '', c] as const)),
        );
        const session = await t.request('/get-session', { headers: { Cookie: [...jar.values()].join('; ') } });
        expect(((await session.json()) as { user?: { id: string } } | null)?.user?.id).toBe(a);
        expect(t.db.session.map((s) => s.userId)).toEqual([a]);
    });
});

describe('twoFactorPlugin（二段階目）', () => {
    it('正しいコードで、パスワードで通った印の付いたセッションを作り、このブラウザーのアカウントにも覚える', async () => {
        const { t, id } = await gatedPasswordUser();
        const challenged = await signIn(t, 'tf@example.com');
        const cookie = cookiesOf(challenged).join('; ');

        const wrong = await verify(t, cookie, '000000');
        expect(wrong.status).toBe(400);
        expect(await wrong.json()).toMatchObject({ code: 'invalid-code' });
        expect(t.db.session).toHaveLength(0);

        const ok = await verify(t, cookie, '123456');
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ returnTo: null });
        expect(t.db.session).toHaveLength(1);
        expect(t.db.session[0]).toMatchObject({ userId: id, authAccountId: null });
        expect(t.db.session[0]?.passwordVerifiedAt).toBeInstanceOf(Date);
        expect(findCookie(ok, 'session_token').some((c) => !/Max-Age=0/i.test(c))).toBe(true);
        expect(findCookie(ok, '_multi-').length).toBeGreaterThan(0);
        expect(findCookie(ok, 'two_factor_challenge')[0]).toMatch(/Max-Age=0/);

        // 同じ途中は 2 度使えない
        const again = await verify(t, cookie, '123456');
        expect(again.status).toBe(400);
        expect(await again.json()).toMatchObject({ code: 'challenge-expired' });
    });

    it('「ログインしたままにしない」はセッションのクッキーを閉じるまでにする', async () => {
        const { t } = await gatedPasswordUser();
        const challenged = await signIn(t, 'tf@example.com', { rememberMe: false });
        const ok = await verify(t, cookiesOf(challenged).join('; '), '123456');
        const session = findCookie(ok, 'session_token').find((c) => !/Max-Age=0/i.test(c)) ?? '';
        expect(session).not.toMatch(/Max-Age/i);
    });

    it('途中のクッキーが無い・改ざんされていれば、最初からやり直させる', async () => {
        const { t } = await gatedPasswordUser();
        await signIn(t, 'tf@example.com');
        for (const cookie of ['', '__Secure-better-auth.two_factor_challenge=forged.sig']) {
            const res = await verify(t, cookie, '123456');
            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ code: 'challenge-expired' });
        }
        expect(t.db.session).toHaveLength(0);
    });

    it('5 回間違えると途中を捨て、正しいコードでも通さない', async () => {
        const { t } = await gatedPasswordUser();
        const cookie = cookiesOf(await signIn(t, 'tf@example.com')).join('; ');
        const codes = await Promise.all(
            Array.from({ length: 5 }, () =>
                verify(t, cookie, '000000').then((r) => r.json() as Promise<{ code?: string }>),
            ),
        );
        expect(codes.filter((c) => c.code === 'challenge-expired')).toHaveLength(1);
        const res = await verify(t, cookie, '123456');
        expect(await res.json()).toMatchObject({ code: 'challenge-expired' });
        expect(t.db.session).toHaveLength(0);
    });
});

describe('twoFactorPlugin（フェディバースのログイン）', () => {
    const signedIn: CallbackOutcome = {
        kind: 'signed-in',
        userId: 'u-sso',
        accountRowId: 'acc-1',
        redirectTo: `${BASE}/@bob/room?x=1`,
    };

    it('有効なら、セッションを作らずにログイン画面の二段階目へ戻し、通ったら外部アカウントを覚えたセッションを作る', async () => {
        const t = setup({ enabled: ['u-sso'], callback: signedIn });
        t.db.account.push({
            id: 'acc-1',
            userId: 'u-sso',
            accountId: 'ext-1',
            providerId: 'fediverse:https://mi.example',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const callback = await t.request('/fediverse/callback/mi.example?code=c&state=s');
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe(`${BASE}/?two_factor=1`);
        expect(t.db.session).toHaveLength(0);
        expect([...t.rows.values()][0]).toMatchObject({
            userId: 'u-sso',
            passwordVerified: false,
            authAccountId: 'acc-1',
            returnTo: '/@bob/room?x=1',
        });

        const ok = await verify(t, cookiesOf(callback).join('; '), '123456');
        expect(await ok.json()).toEqual({ returnTo: '/@bob/room?x=1' });
        expect(t.db.session).toHaveLength(1);
        expect(t.db.session[0]).toMatchObject({ userId: 'u-sso', authAccountId: 'acc-1' });
        expect(t.db.session[0]?.passwordVerifiedAt ?? null).toBeNull();
    });

    it('無効なら、いつもどおりセッションを作って戻す', async () => {
        const t = setup({ callback: signedIn });
        const callback = await t.request('/fediverse/callback/mi.example?code=c&state=s');
        expect(callback.headers.get('location')).toBe(`${BASE}/@bob/room?x=1`);
        expect(t.db.session).toHaveLength(1);
    });
});
