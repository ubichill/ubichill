/**
 * 登録を終えた人を、そのままログインさせる（routes/users/registration.ts が本登録の後にサーバーの中から呼ぶ）。
 * HTTP からは呼べない（SERVER_ONLY。authEndpoints の許可リストにも入れない）。
 * セッションはパスワードのログインと同じ形で作る（登録で決めたパスワードを確かめた扱い）。
 */
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';
import { type SecondFactorGate, signInOrChallenge } from './twoFactorPlugin';

export function registrationSignInPlugin({ gate }: { gate: SecondFactorGate }) {
    return {
        id: 'ubichill-registration-sign-in',
        endpoints: {
            registrationSignIn: createAuthEndpoint(
                '/registration/sign-in',
                { method: 'POST', body: z.object({ userId: z.string().min(1) }), metadata: { SERVER_ONLY: true } },
                async (ctx) => {
                    const result = await signInOrChallenge(ctx, gate, {
                        userId: ctx.body.userId,
                        passwordVerified: true,
                        authAccountId: null,
                        remember: true,
                        returnTo: null,
                    });
                    return ctx.json({ signedIn: result === 'signed-in' });
                },
            ),
        },
    } satisfies BetterAuthPlugin;
}
