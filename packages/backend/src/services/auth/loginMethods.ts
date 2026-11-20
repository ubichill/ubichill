/**
 * ログイン方法（パスワードの有無・追加したフェディバースのアカウント）と本人確認の記録。route は DB を知らないので、ここを通す。
 */
import { fediverseAccountRepository, userRepository } from '@ubichill/db';
import { FEDIVERSE_SOFTWARE, type FediverseSoftware, fediverseHostOf, type LoginMethods } from '@ubichill/shared';
import { loadLoginPolicy } from './fediverse';
import { isRecentlyAuthenticated, type SessionFacts } from './sessionAssurance';

const isSoftware = (s: string | null): s is FediverseSoftware =>
    s !== null && (FEDIVERSE_SOFTWARE as readonly string[]).includes(s);

export const loginMethodService = {
    /** 画面に出すログイン方法（今の設定で使えるかと、このセッションが直近に本人確認したか） */
    async of(userId: string, session: SessionFacts, now: Date): Promise<LoginMethods> {
        const [password, linked, usable] = await Promise.all([
            fediverseAccountRepository.hasPassword(userId),
            fediverseAccountRepository.listLinked(userId),
            loadLoginPolicy(),
        ]);
        return {
            password,
            recentlyAuthenticated: isRecentlyAuthenticated(session, now, password),
            fediverse: linked.map((a) => ({
                id: a.id,
                server: fediverseHostOf(a.providerId) ?? a.providerId,
                username: a.username,
                software: isSoftware(a.software) ? a.software : null,
                linkedAt: a.createdAt.toISOString(),
                usable: usable(a.providerId),
            })),
        };
    },

    /**
     * フェディバースのアカウントを外す。今の設定で使えるログイン手段が残らなくなるなら外さない。
     * 外したアカウントで作ったほかのセッションも消える（sessions.auth_account_id の FK。今のセッションは残す）
     */
    async unlink(userId: string, accountRowId: string, currentSessionId: string | null) {
        return fediverseAccountRepository.unlink(userId, accountRowId, await loadLoginPolicy(), currentSessionId);
    },

    /** このセッションでパスワードを確かめた時刻を記録する（管理者の権限・本人確認に使う） */
    markPasswordVerified: (userId: string, sessionId: string, at: Date): Promise<boolean> =>
        userRepository.markSessionPasswordVerified(userId, sessionId, at),
};
