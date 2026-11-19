/**
 * セッションに「どう本人を確かめたか」を残す better-auth の設定（services/auth/sessionAssurance.ts）。
 * auth.ts とテストで同じものを使う。
 */
import type { BetterAuthOptions } from 'better-auth';

/** パスワードを確かめてからセッションを作る better-auth のエンドポイント（ログイン・パスワード変更）。 */
const PASSWORD_SESSION_PATHS: ReadonlySet<string> = new Set(['/sign-in/email', '/change-password']);

export const sessionAssuranceFields = {
    passwordVerifiedAt: { type: 'date', required: false, input: false },
    authAccountId: { type: 'string', required: false, input: false },
} as const;

export const sessionAssuranceHooks = {
    session: {
        create: {
            // パスワードを確かめて作ったセッションに印を付ける。ほかの作り方（SSO など）は付けない
            before: async (session, ctx) =>
                ctx && PASSWORD_SESSION_PATHS.has(ctx.path)
                    ? { data: { ...session, passwordVerifiedAt: new Date() } }
                    : undefined,
        },
    },
} satisfies BetterAuthOptions['databaseHooks'];
