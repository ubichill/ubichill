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
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import type { FediverseSignIn } from '../services/auth/fediverse/signIn';
import { SIGN_UP_TTL_MS, STATE_TTL_MS } from '../services/auth/fediverse/signIn';
import { isRecentlyAuthenticated, toDateOrNull } from '../services/auth/sessionAssurance';

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

/** SSO でのログイン。どの外部アカウントで入ったかをセッションに残す（外部アカウントを外すとこのセッションも消える）。 */
async function signInAs(ctx: EndpointContext, userId: string, accountRowId: string): Promise<void> {
    const user = await ctx.context.internalAdapter.findUserById(userId);
    if (!user) throw new Error('ユーザーが見つかりません');
    const session = await ctx.context.internalAdapter.createSession(userId, false, { authAccountId: accountRowId });
    await setSessionCookie(ctx, { session, user });
}

export interface FediverseSignInPluginOptions {
    getSignIn: () => Promise<FediverseSignIn>;
    /** ログイン画面に出す設定（使えるか・新規登録を受け付けるか・並べるサーバー） */
    options: () => { enabled: boolean; registrationOpen: boolean; featuredServers: readonly string[] };
}

export function fediverseSignInPlugin({ getSignIn, options }: FediverseSignInPluginOptions) {
    return {
        id: 'fediverse-sign-in',
        endpoints: {
            fediverseOptions: createAuthEndpoint('/fediverse/options', { method: 'GET' }, async (ctx) =>
                ctx.json(options()),
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
                    const current =
                        ctx.body.intent === 'link'
                            ? await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true })
                            : null;
                    // 奪われたセッションでログイン方法を足されないよう、直近にログインか再認証をしたセッションに限る
                    if (
                        current &&
                        !isRecentlyAuthenticated(
                            {
                                createdAt: toDateOrNull(current.session.createdAt) ?? new Date(0),
                                passwordVerifiedAt: toDateOrNull(current.session.passwordVerifiedAt),
                            },
                            new Date(),
                        )
                    ) {
                        throw APIError.fromStatus('FORBIDDEN', { code: 'reauth-required', message: 'reauth-required' });
                    }
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
                    if (outcome.kind === 'signed-in') await signInAs(ctx, outcome.userId, outcome.accountRowId);
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
                    await signInAs(ctx, outcome.userId, outcome.accountRowId);
                    return ctx.json({ returnTo: outcome.returnTo });
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

            fediverseClient: createAuthEndpoint('/fediverse/client/:server', { method: 'GET' }, async (ctx) => {
                const html = (await getSignIn()).clientDocument(ctx.params.server);
                if (!html) return new Response('Not Found', { status: 404 });
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
                });
            }),
        },
        rateLimit: [
            // 開始は相手のサーバーへ要求を送る（アプリ登録・メタデータ）ので、IP ごとに強く絞る
            { pathMatcher: (path: string) => path === '/fediverse/start', window: 60, max: 10 },
            { pathMatcher: (path: string) => path === '/fediverse/sign-up', window: 60, max: 20 },
            // 並べたサーバーと入力したサーバーごとに呼ばれ、相手へ要求を送る（結果は backend が 5 分覚える）
            { pathMatcher: (path: string) => path === '/fediverse/lookup', window: 60, max: 30 },
        ],
    } satisfies BetterAuthPlugin;
}
