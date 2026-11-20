/**
 * フェディバースのログインを better-auth のエンドポイントとして公開する（セッションとクッキーを better-auth と同じ形で
 * 発行するため）。流れの判断は services/auth/fediverse/signIn.ts にあり、ここは HTTP とクッキーの対応付けだけ。
 *
 * クッキー（署名付き・httpOnly・/api/auth/fediverse だけに送る）:
 * - fediverse_flow: 開始したブラウザーの印（応答を他人に踏ませてログインさせる攻撃を防ぐ）
 * - fediverse_sign_up: 初回登録の途中の状態の鍵
 */
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { z } from 'zod';
import type { FediverseSignIn } from '../services/auth/fediverse/signIn';
import { SIGN_UP_TTL_MS, STATE_TTL_MS } from '../services/auth/fediverse/signIn';
import { type SecondFactorGate, signInOrChallenge } from './twoFactorPlugin';

const STATUS = { 400: 'BAD_REQUEST', 404: 'NOT_FOUND', 409: 'CONFLICT' } as const;

const COOKIE_PATH = '/api/auth/fediverse';
const FLOW_COOKIE = 'fediverse_flow';
const SIGN_UP_COOKIE = 'fediverse_sign_up';

type EndpointContext = GenericEndpointContext;

function cookie(ctx: EndpointContext, name: string, maxAgeMs: number) {
    return ctx.context.createAuthCookie(name, {
        path: COOKIE_PATH,
        sameSite: 'lax',
        httpOnly: true,
        maxAge: Math.floor(maxAgeMs / 1000),
    });
}

async function readCookie(ctx: EndpointContext, name: string, maxAgeMs: number): Promise<string | null> {
    const value = await ctx.getSignedCookie(cookie(ctx, name, maxAgeMs).name, ctx.context.secret);
    return typeof value === 'string' && value ? value : null;
}

function clearCookie(ctx: EndpointContext, name: string) {
    const { name: cookieName, attributes } = cookie(ctx, name, 0);
    ctx.setCookie(cookieName, '', { ...attributes, maxAge: 0 });
}

/**
 * SSO でのログイン。どの外部アカウントで入ったかをセッションに残す（外部アカウントを外すとこのセッションも消える）。
 * 二段階認証が有効なら、セッションを作らずに二段階目を求める。
 */
const signInAs = (
    ctx: EndpointContext,
    gate: SecondFactorGate,
    input: { userId: string; accountRowId: string; returnTo: string },
) =>
    signInOrChallenge(ctx, gate, {
        userId: input.userId,
        passwordVerified: false,
        authAccountId: input.accountRowId,
        remember: true,
        returnTo: input.returnTo,
    });

/** 二段階目を求めるとき、認証から戻る先（ログイン画面でコードを入れ、通ったら元の戻り先へ）。 */
function twoFactorRedirect(redirectTo: string): { url: string; returnTo: string } {
    const url = new URL(redirectTo);
    return { url: `${url.origin}/auth?two_factor=1`, returnTo: `${url.pathname}${url.search}${url.hash}` };
}

export interface FediverseSignInPluginOptions {
    getSignIn: () => Promise<FediverseSignIn>;
    /** ログインの二段階目（lib/twoFactorPlugin.ts） */
    secondFactor: SecondFactorGate;
    /** ログイン画面に出す設定（使えるか・新規登録を受け付けるか・並べるサーバー） */
    options: () => Promise<{ enabled: boolean; registrationOpen: boolean; featuredServers: readonly string[] }>;
}

export function fediverseSignInPlugin({ getSignIn, secondFactor, options }: FediverseSignInPluginOptions) {
    return {
        id: 'fediverse-sign-in',
        endpoints: {
            fediverseOptions: createAuthEndpoint('/fediverse/options', { method: 'GET' }, async (ctx) =>
                ctx.json(await options()),
            ),

            fediverseStart: createAuthEndpoint(
                '/fediverse/start',
                {
                    method: 'POST',
                    body: z.object({
                        server: z.string().max(300),
                        intent: z.enum(['sign-in', 'link']).default('sign-in'),
                        prefer: z.enum(['sign-in', 'sign-up']).optional(),
                        returnTo: z.string().max(2000).optional(),
                    }),
                },
                async (ctx) => {
                    // 連携は DB のセッションで確かめる（取り消したログインのクッキーキャッシュでは足させない）。
                    // パスワードの入れ直しは求めない。足したことは連絡先に知らせ、設定の一覧で外せる
                    const current =
                        ctx.body.intent === 'link'
                            ? await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true })
                            : null;
                    const started = await (await getSignIn()).start({
                        server: ctx.body.server,
                        intent: ctx.body.intent,
                        prefer: ctx.body.prefer,
                        returnTo: ctx.body.returnTo,
                        origin: ctx.request?.headers.get('origin') ?? ctx.headers?.get('origin') ?? null,
                        session: current ? { userId: current.user.id, sessionId: current.session.id } : null,
                    });
                    if (!started.ok) {
                        ctx.context.logger.warn(
                            `フェディバースのログインを始められません: ${ctx.body.server} (${started.error})`,
                        );
                        throw APIError.fromStatus('BAD_REQUEST', { code: started.error, message: started.error });
                    }
                    const { name, attributes } = cookie(ctx, FLOW_COOKIE, STATE_TTL_MS);
                    await ctx.setSignedCookie(name, started.browserToken, ctx.context.secret, attributes);
                    return ctx.json({ url: started.authorizationUrl });
                },
            ),

            fediverseCallback: createAuthEndpoint(
                '/fediverse/callback/:server',
                {
                    method: 'GET',
                    query: z.object({
                        code: z.string().max(2000).optional(),
                        state: z.string().max(200).optional(),
                        iss: z.string().max(300).optional(),
                        error: z.string().max(200).optional(),
                        // Misskey（MiAuth）の戻りはセッション ID だけ
                        session: z.string().max(200).optional(),
                    }),
                },
                async (ctx) => {
                    const browserToken = await readCookie(ctx, FLOW_COOKIE, STATE_TTL_MS);
                    const current = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
                    const outcome = await (await getSignIn()).callback({
                        server: ctx.params.server,
                        query: ctx.query,
                        browserToken,
                        sessionId: current?.session.id ?? null,
                    });
                    clearCookie(ctx, FLOW_COOKIE);
                    if (outcome.kind === 'signed-in') {
                        const next = twoFactorRedirect(outcome.redirectTo);
                        const signedIn = await signInAs(ctx, secondFactor, {
                            userId: outcome.userId,
                            accountRowId: outcome.accountRowId,
                            returnTo: next.returnTo,
                        });
                        if (signedIn === 'two-factor') throw ctx.redirect(next.url);
                    }
                    if (outcome.kind === 'sign-up') {
                        const { name, attributes } = cookie(ctx, SIGN_UP_COOKIE, SIGN_UP_TTL_MS);
                        await ctx.setSignedCookie(name, outcome.ticket, ctx.context.secret, attributes);
                    }
                    throw ctx.redirect(outcome.redirectTo);
                },
            ),

            fediverseSignUpCandidate: createAuthEndpoint('/fediverse/sign-up', { method: 'GET' }, async (ctx) => {
                const ticket = await readCookie(ctx, SIGN_UP_COOKIE, SIGN_UP_TTL_MS);
                const candidate = await (await getSignIn()).signUpCandidate(ticket);
                if (!candidate) throw APIError.fromStatus('NOT_FOUND', { message: '登録の期限が切れました' });
                return ctx.json(candidate);
            }),

            fediverseSignUp: createAuthEndpoint(
                '/fediverse/sign-up',
                {
                    method: 'POST',
                    body: z.object({ handle: z.string().max(100), displayName: z.string().max(200) }),
                },
                async (ctx) => {
                    const ticket = await readCookie(ctx, SIGN_UP_COOKIE, SIGN_UP_TTL_MS);
                    const outcome = await (await getSignIn()).signUp({
                        ticket,
                        handle: ctx.body.handle,
                        displayName: ctx.body.displayName,
                    });
                    if (!outcome.ok) throw APIError.fromStatus(STATUS[outcome.status], { message: outcome.error });
                    clearCookie(ctx, SIGN_UP_COOKIE);
                    // 登録済みだった（認証の後にほかの画面で登録した）ときは、二段階認証を求めることがある
                    const signedIn = await signInAs(ctx, secondFactor, {
                        userId: outcome.userId,
                        accountRowId: outcome.accountRowId,
                        returnTo: outcome.returnTo,
                    });
                    return ctx.json(
                        signedIn === 'two-factor'
                            ? { returnTo: outcome.returnTo, twoFactorRequired: true }
                            : { returnTo: outcome.returnTo },
                    );
                },
            ),

            fediverseCancelSignUp: createAuthEndpoint('/fediverse/sign-up', { method: 'DELETE' }, async (ctx) => {
                await (await getSignIn()).cancelSignUp(await readCookie(ctx, SIGN_UP_COOKIE, SIGN_UP_TTL_MS));
                clearCookie(ctx, SIGN_UP_COOKIE);
                return ctx.json({ ok: true });
            }),

            fediverseLookup: createAuthEndpoint(
                '/fediverse/lookup',
                { method: 'GET', query: z.object({ server: z.string().max(300) }) },
                async (ctx) => {
                    const outcome = await (await getSignIn()).lookup(ctx.query.server);
                    if (!outcome.ok) {
                        throw APIError.fromStatus('BAD_REQUEST', { code: outcome.error, message: outcome.error });
                    }
                    return ctx.json(outcome.server);
                },
            ),
        },
        rateLimit: [
            // IP ごとの制限は Express の側（index.ts）。better-auth は IP を取れないと全員で 1 つの枠にするので、
            // ここで絞ると 1 人で全員を止められる。既定（100 回/分）より緩めて、全体の上限としてだけ置く
            { pathMatcher: (path: string) => path === '/fediverse/start', window: 60, max: 2000 },
            { pathMatcher: (path: string) => path === '/fediverse/sign-up', window: 60, max: 2000 },
            { pathMatcher: (path: string) => path === '/fediverse/lookup', window: 60, max: 5000 },
        ],
    } satisfies BetterAuthPlugin;
}
