/**
 * パスワードのログイン（`/sign-in/email`）で、メールアドレスの代わりに ID も受け付ける。
 * better-auth に入る前に ID をその人のメールアドレスに置き換えるだけなので、回数の制限・ボット対策・
 * 二段階認証はメールアドレスで入れたときと同じに効く。
 */
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

export function signInIdentifierPlugin({
    resolveEmail,
}: {
    /** 入力が ID なら渡すメールアドレス。メールアドレスなら null */
    resolveEmail(input: string): Promise<string | null>;
}) {
    return {
        id: 'sign-in-identifier',
        hooks: {
            before: [
                {
                    matcher: (context) => context.path === '/sign-in/email',
                    handler: createAuthMiddleware(async (ctx) => {
                        const body = ctx.body as Record<string, unknown> | undefined;
                        if (typeof body?.email !== 'string') return;
                        const email = await resolveEmail(body.email);
                        if (email === null) return;
                        return { context: { body: { ...body, email } } };
                    }),
                },
            ],
        },
    } satisfies BetterAuthPlugin;
}
