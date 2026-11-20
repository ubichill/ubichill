/**
 * 1 つのブラウザーで複数のアカウントを使い分ける（アカウントの切り替え・このアカウントだけログアウト）。
 *
 * ログインしたセッションを「このブラウザーのアカウント」として覚えるのは better-auth の multiSession（署名付きの
 * httpOnly のクッキー `<セッションのクッキー名>_multi-<トークン>`）に任せる。multiSession の一覧の口はセッションの
 * トークンを画面へ返すので公開せず、ここではユーザー ID で選ぶ口だけを出す（トークンを JavaScript に渡さない）。
 */
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie, parseCookies, setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

type Ctx = GenericEndpointContext;
type FoundSession = NonNullable<Awaited<ReturnType<Ctx['context']['internalAdapter']['findSession']>>>;

const multiCookieName = (ctx: Ctx, token: string) =>
    `${ctx.context.authCookies.sessionToken.name}_multi-${token.toLowerCase()}`;

/** このブラウザーが覚えているアカウントの、期限内のセッション（ユーザーごとに 1 つ）。 */
async function rememberedSessions(ctx: Ctx): Promise<FoundSession[]> {
    const cookies = Object.fromEntries(parseCookies(ctx.headers?.get('cookie') ?? ''));
    const tokens = (
        await Promise.all(
            Object.keys(cookies)
                .filter((key) => key.includes('_multi-'))
                .map((key) => ctx.getSignedCookie(key, ctx.context.secret)),
        )
    ).filter((token): token is string => typeof token === 'string' && token.length > 0);
    if (tokens.length === 0) return [];
    const now = new Date();
    const found = await ctx.context.internalAdapter.findSessions(tokens);
    return found
        .filter((s): s is FoundSession => !!s && s.session.expiresAt > now)
        .filter((s, i, all) => all.findIndex((o) => o.user.id === s.user.id) === i);
}

/** 今のセッションも覚えておく（このプラグインより前にログインしたセッションは覚えられていない）。 */
async function remember(ctx: Ctx, token: string): Promise<void> {
    await ctx.setSignedCookie(
        multiCookieName(ctx, token),
        token,
        ctx.context.secret,
        ctx.context.authCookies.sessionToken.attributes,
    );
}

const accountView = (s: FoundSession, activeUserId: string | null) => ({
    userId: s.user.id,
    name: s.user.name,
    handle: typeof s.user.handle === 'string' ? s.user.handle : '',
    image: s.user.image ?? null,
    active: s.user.id === activeUserId,
});

export function accountSwitchPlugin() {
    return {
        id: 'account-switch',
        endpoints: {
            accountSwitchList: createAuthEndpoint('/account-switch/accounts', { method: 'GET' }, async (ctx) => {
                const current = await getSessionFromCtx(ctx);
                if (current) await remember(ctx, current.session.token);
                const sessions = await rememberedSessions(ctx);
                const all =
                    current && !sessions.some((s) => s.user.id === current.user.id) ? [current, ...sessions] : sessions;
                return ctx.json({ accounts: all.map((s) => accountView(s, current?.user.id ?? null)) });
            }),

            accountSwitchSwitch: createAuthEndpoint(
                '/account-switch/switch',
                { method: 'POST', body: z.object({ userId: z.string().max(100) }) },
                async (ctx) => {
                    const current = await getSessionFromCtx(ctx);
                    const target = (await rememberedSessions(ctx)).find((s) => s.user.id === ctx.body.userId);
                    if (!target) throw APIError.fromStatus('NOT_FOUND', { message: 'このアカウントは覚えていません' });
                    // 戻ってこられるよう、今のセッションも覚えてから切り替える
                    if (current) await remember(ctx, current.session.token);
                    await setSessionCookie(ctx, target);
                    return ctx.json({ userId: target.user.id });
                },
            ),

            accountSwitchSignOut: createAuthEndpoint('/account-switch/sign-out', { method: 'POST' }, async (ctx) => {
                const current = await getSessionFromCtx(ctx, { disableCookieCache: true });
                if (current) {
                    await ctx.context.internalAdapter.deleteSession(current.session.token);
                    const { attributes } = ctx.context.authCookies.sessionToken;
                    ctx.setCookie(multiCookieName(ctx, current.session.token), '', { ...attributes, maxAge: 0 });
                }
                // ほかに覚えているアカウントがあれば、そちらに切り替える
                const next = (await rememberedSessions(ctx)).find((s) => s.user.id !== current?.user.id);
                if (next) {
                    await setSessionCookie(ctx, next);
                    return ctx.json({ next: next.user.id });
                }
                deleteSessionCookie(ctx);
                return ctx.json({ next: null });
            }),
        },
    } satisfies BetterAuthPlugin;
}
