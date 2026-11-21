/**
 * ログインの二段階目を better-auth に組み込む。規則と手順は services/auth/twoFactor/。
 * - パスワードのログイン（/sign-in/email）: better-auth が作ったセッションを消し、二段階目の途中を発行する。
 * - フェディバースのログイン: fediverseSignInPlugin が `signInOrChallenge` でセッションを作る代わりに途中を発行する。
 * - /two-factor/verify: コードを確かめ、一段階目の情報（パスワードで通ったか・どの外部アカウントか）を
 *   引き継いでセッションを作る。
 *
 * 途中の印は署名付き・httpOnly のクッキー（/api/auth/two-factor にだけ送る）。
 */
import type { TwoFactorRequired, TwoFactorSignedIn } from '@ubichill/shared';
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { CHALLENGE_TTL_MS, type ChallengeOutcome, type FirstFactor } from '../services/auth/twoFactor/challenges';

const COOKIE_PATH = '/api/auth/two-factor';
const CHALLENGE_COOKIE = 'two_factor_challenge';

/** 二段階目の判断（本番は services/auth/twoFactor/index.ts）。 */
export interface SecondFactorGate {
    required(userId: string): Promise<boolean>;
    issue(first: FirstFactor): Promise<string>;
    complete(token: string | null, code: unknown): Promise<ChallengeOutcome>;
}

function challengeCookie(ctx: GenericEndpointContext, maxAgeMs: number) {
    return ctx.context.createAuthCookie(CHALLENGE_COOKIE, {
        path: COOKIE_PATH,
        sameSite: 'lax',
        httpOnly: true,
        maxAge: Math.floor(maxAgeMs / 1000),
    });
}

async function setChallengeCookie(ctx: GenericEndpointContext, token: string): Promise<void> {
    const { name, attributes } = challengeCookie(ctx, CHALLENGE_TTL_MS);
    await ctx.setSignedCookie(name, token, ctx.context.secret, attributes);
}

function clearChallengeCookie(ctx: GenericEndpointContext): void {
    const { name, attributes } = challengeCookie(ctx, 0);
    ctx.setCookie(name, '', { ...attributes, maxAge: 0 });
}

/**
 * 一段階目を通ったユーザーをログインさせる。二段階認証が有効ならセッションを作らずに途中を発行する。
 * セッションには一段階目の情報（パスワードで通ったか・どの外部アカウントか）を残す。
 */
export async function signInOrChallenge(
    ctx: GenericEndpointContext,
    gate: SecondFactorGate,
    first: FirstFactor,
): Promise<'signed-in' | 'two-factor'> {
    if (await gate.required(first.userId)) {
        await setChallengeCookie(ctx, await gate.issue(first));
        return 'two-factor';
    }
    await createSignedInSession(ctx, first);
    return 'signed-in';
}

async function createSignedInSession(ctx: GenericEndpointContext, first: Omit<FirstFactor, 'returnTo'>) {
    const user = await ctx.context.internalAdapter.findUserById(first.userId);
    if (!user) throw APIError.fromStatus('UNAUTHORIZED', { message: 'アカウントが見つかりません' });
    const session = await ctx.context.internalAdapter.createSession(first.userId, !first.remember, {
        passwordVerifiedAt: first.passwordVerified ? new Date() : null,
        authAccountId: first.authAccountId,
    });
    await setSessionCookie(ctx, { session, user }, !first.remember);
}

/** このブラウザーが今ログインしているセッション（新しく作ったものを除く。期限切れ・取り消し済みなら null）。 */
async function previousSession(ctx: GenericEndpointContext, createdToken: string) {
    const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
    if (typeof token !== 'string' || !token || token === createdToken) return null;
    const found = await ctx.context.internalAdapter.findSession(token);
    return found && new Date(found.session.expiresAt) > new Date() ? found : null;
}

const ERROR_STATUS = {
    'challenge-expired': 'BAD_REQUEST',
    'invalid-code': 'BAD_REQUEST',
    locked: 'TOO_MANY_REQUESTS',
} as const;

export function twoFactorPlugin({ gate }: { gate: SecondFactorGate }) {
    return {
        id: 'ubichill-two-factor',
        endpoints: {
            twoFactorVerify: createAuthEndpoint(
                '/two-factor/verify',
                { method: 'POST', body: z.object({ code: z.string().max(64) }) },
                async (ctx) => {
                    const token = await ctx.getSignedCookie(challengeCookie(ctx, 0).name, ctx.context.secret);
                    const outcome = await gate.complete(
                        typeof token === 'string' && token ? token : null,
                        ctx.body.code,
                    );
                    if (!outcome.ok) {
                        if (outcome.error !== 'invalid-code') clearChallengeCookie(ctx);
                        throw APIError.fromStatus(ERROR_STATUS[outcome.error], {
                            code: outcome.error,
                            message: outcome.message,
                        });
                    }
                    clearChallengeCookie(ctx);
                    await createSignedInSession(ctx, outcome);
                    return ctx.json({ returnTo: outcome.returnTo } satisfies TwoFactorSignedIn);
                },
            ),
        },
        hooks: {
            after: [
                {
                    // パスワードで通ったが二段階認証が有効: better-auth が作ったセッションを消し、途中を発行する。
                    // multiSession より前に置く（消したセッションを「このブラウザーのアカウント」に覚えさせない）
                    matcher: (context) => context.path === '/sign-in/email',
                    handler: createAuthMiddleware(async (ctx) => {
                        const created = ctx.context.newSession;
                        if (!created || !(await gate.required(created.user.id))) return;
                        const previous = await previousSession(ctx, created.session.token);
                        deleteSessionCookie(ctx);
                        await ctx.context.internalAdapter.deleteSession(created.session.token);
                        // 「アカウントを追加」の途中なら、元のアカウントのログインをこのブラウザーに残す
                        if (previous) await setSessionCookie(ctx, previous);
                        ctx.context.setNewSession(null);
                        const body = ctx.body as { rememberMe?: unknown } | undefined;
                        await setChallengeCookie(
                            ctx,
                            await gate.issue({
                                userId: created.user.id,
                                passwordVerified: true,
                                authAccountId: null,
                                remember: body?.rememberMe !== false,
                                returnTo: null,
                            }),
                        );
                        return ctx.json({ twoFactorRequired: true } satisfies TwoFactorRequired);
                    }),
                },
            ],
        },
        rateLimit: [
            // IP ごとの制限は Express の側（index.ts）。ここは全体の上限だけ（fediverseSignInPlugin と同じ理由）
            { pathMatcher: (path: string) => path === '/two-factor/verify', window: 60, max: 2000 },
        ],
    } satisfies BetterAuthPlugin;
}
