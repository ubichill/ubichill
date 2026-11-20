/**
 * ログイン中の端末（設定の「アカウント」）。どの端末で・いつ・どの方法で入ったかを本人に見せ、知らない端末を
 * ログアウトできるようにする（連携の追加にパスワードを求めないので、気付ける手段を置く）。
 */
import { type AccountSessionRecord, userRepository } from '@ubichill/db';
import { type AccountSessionView, fediverseHostOf } from '@ubichill/shared';

/** 画面に出す形にする（トークンは元から持たない）。 */
export function accountSessionView(record: AccountSessionRecord, currentSessionId: string): AccountSessionView {
    const host = record.authProviderId ? fediverseHostOf(record.authProviderId) : null;
    return {
        id: record.id,
        createdAt: record.createdAt.toISOString(),
        lastActiveAt: record.updatedAt.toISOString(),
        current: record.id === currentSessionId,
        userAgent: record.userAgent?.slice(0, 300) ?? null,
        ipAddress: record.ipAddress,
        via: host
            ? { kind: 'fediverse', account: record.authUsername ? `@${record.authUsername}@${host}` : host }
            : record.passwordVerifiedAt
              ? { kind: 'password' }
              : null,
    };
}

export const accountSessionService = {
    async list(userId: string, currentSessionId: string, now: Date): Promise<AccountSessionView[]> {
        return (await userRepository.listSessions(userId, now)).map((s) => accountSessionView(s, currentSessionId));
    },

    /** ほかの端末を 1 つログアウトする。今の端末はメニューのログアウトで（ここでは消さない）。 */
    async revoke(
        userId: string,
        sessionId: string,
        currentSessionId: string,
    ): Promise<'revoked' | 'not-found' | 'current'> {
        if (sessionId === currentSessionId) return 'current';
        return (await userRepository.deleteSession(userId, sessionId)) ? 'revoked' : 'not-found';
    },
};
