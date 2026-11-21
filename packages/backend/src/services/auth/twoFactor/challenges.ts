/**
 * ログインの二段階目。一段階目（パスワード・フェディバース）を通ったら、セッションを作らずにこの「途中」を発行し、
 * 認証アプリのコードを確かめてからセッションを作る。途中の状態はブラウザーの乱数の SHA-256 で引く。
 * 1 つの途中で試せるのは attempts 回まで（ユーザーごとの回数の上限は twoFactor.ts）。
 */
import type { TwoFactorChallengeRecord } from '@ubichill/db';
import type { TwoFactorSignInError } from '@ubichill/shared';
import type { CodeCheck } from './twoFactor';

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const CHALLENGE_ATTEMPTS = 5;

export interface ChallengeDeps {
    repository: {
        create(record: Omit<TwoFactorChallengeRecord, 'attempts'>): Promise<void>;
        beginAttempt(id: string, now: Date, maxAttempts: number): Promise<TwoFactorChallengeRecord | undefined>;
        consume(id: string, now: Date): Promise<TwoFactorChallengeRecord | undefined>;
        remove(id: string): Promise<void>;
    };
    verify(userId: string, code: unknown): Promise<CodeCheck>;
    /** ブラウザーに渡す乱数 */
    newToken(): string;
    hashToken(token: string): string;
    now(): Date;
    lockedError: string;
}

/** 一段階目をどう通ったか（作るセッションに引き継ぐ）。 */
export interface FirstFactor {
    userId: string;
    /** パスワードで通った */
    passwordVerified: boolean;
    /** フェディバースで通った外部アカウント（accounts.id） */
    authAccountId: string | null;
    remember: boolean;
    returnTo: string | null;
}

export type ChallengeOutcome =
    | ({ ok: true } & FirstFactor)
    | { ok: false; error: TwoFactorSignInError; message: string };

const expired = (message = 'ログインの期限が切れました。もう一度ログインしてください'): ChallengeOutcome => ({
    ok: false,
    error: 'challenge-expired',
    message,
});

export function createTwoFactorChallenges(deps: ChallengeDeps) {
    return {
        /** 途中を発行し、ブラウザーに渡す乱数を返す。 */
        async issue(first: FirstFactor): Promise<string> {
            const token = deps.newToken();
            await deps.repository.create({
                id: deps.hashToken(token),
                ...first,
                expiresAt: new Date(deps.now().getTime() + CHALLENGE_TTL_MS),
            });
            return token;
        },

        /** コードを確かめる。通れば途中を使い切り、一段階目の情報を返す（呼び手がセッションを作る）。 */
        async complete(token: string | null, code: unknown): Promise<ChallengeOutcome> {
            if (!token) return expired();
            const id = deps.hashToken(token);
            const attempt = await deps.repository.beginAttempt(id, deps.now(), CHALLENGE_ATTEMPTS);
            if (!attempt) {
                await deps.repository.remove(id);
                return expired();
            }
            const checked = await deps.verify(attempt.userId, code);
            if (checked.ok) {
                const consumed = await deps.repository.consume(id, deps.now());
                if (!consumed) return expired();
                return {
                    ok: true,
                    userId: consumed.userId,
                    passwordVerified: consumed.passwordVerified,
                    authAccountId: consumed.authAccountId,
                    remember: consumed.remember,
                    returnTo: consumed.returnTo,
                };
            }
            switch (checked.reason) {
                case 'not-enabled':
                    // 途中で二段階認証が外された。ログインし直せば二段階目なしで入れる
                    await deps.repository.remove(id);
                    return expired('もう一度ログインしてください');
                case 'locked':
                    await deps.repository.remove(id);
                    return { ok: false, error: 'locked', message: deps.lockedError };
                case 'invalid-code':
                    if (attempt.attempts >= CHALLENGE_ATTEMPTS) {
                        await deps.repository.remove(id);
                        return expired('コードを何度も間違えました。もう一度ログインしてください');
                    }
                    return { ok: false, error: 'invalid-code', message: 'コードが正しくありません' };
            }
        },
    };
}

export type TwoFactorChallenges = ReturnType<typeof createTwoFactorChallenges>;
