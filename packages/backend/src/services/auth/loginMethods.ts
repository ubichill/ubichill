/**
 * ログイン方法（メールアドレスとパスワード・追加したフェディバースのアカウント）と本人確認の記録。
 * ログイン方法は連携（フェディバースのアカウント・メールアドレス）を足すと増える。route は DB を知らないので、ここを通す。
 */
import { fediverseAccountRepository, userRepository } from '@ubichill/db';
import {
    contactEmailOf,
    FEDIVERSE_SOFTWARE,
    type FediverseSoftware,
    fediverseHostOf,
    type LoginMethods,
} from '@ubichill/shared';
import { sendAccountNotice } from '../../lib/auth';
import { loadLoginPolicy } from './fediverse';
import { isRecentlyAuthenticated, type SessionFacts } from './sessionAssurance';

const isSoftware = (s: string | null): s is FediverseSoftware =>
    s !== null && (FEDIVERSE_SOFTWARE as readonly string[]).includes(s);

export const loginMethodService = {
    /** 画面に出すログイン方法（今の設定で使えるかと、このセッションが直近に本人確認したか） */
    async of(userId: string, session: SessionFacts, now: Date): Promise<LoginMethods> {
        const [user, password, linked, usable] = await Promise.all([
            userRepository.findById(userId),
            fediverseAccountRepository.hasPassword(userId),
            fediverseAccountRepository.listLinked(userId),
            loadLoginPolicy(),
        ]);
        return {
            password,
            email: user ? contactEmailOf(user) : null,
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
        const linked = await fediverseAccountRepository.listLinked(userId);
        const outcome = await fediverseAccountRepository.unlink(
            userId,
            accountRowId,
            await loadLoginPolicy(),
            currentSessionId,
        );
        const removed = linked.find((a) => a.id === accountRowId);
        if (outcome.status === 'unlinked' && removed) {
            // パスワードを入れ直さずに外せるので、乗っ取りに本人が気付けるように知らせる
            const user = await userRepository.findById(userId);
            const account = removed.username
                ? `@${removed.username}@${fediverseHostOf(removed.providerId) ?? removed.providerId}`
                : (fediverseHostOf(removed.providerId) ?? removed.providerId);
            if (user) {
                void sendAccountNotice(
                    user,
                    'ログイン方法が外されました',
                    `${user.name} さんのアカウントから、ログイン方法の ${account} が外されました。\n\n` +
                        '心当たりが無い場合は、設定の「アカウント」でほかの端末をログアウトし、パスワードを変更してください。',
                );
            }
        }
        return outcome;
    },

    /** このセッションでパスワードを確かめた時刻を記録する（管理者の権限・本人確認に使う） */
    markPasswordVerified: (userId: string, sessionId: string, at: Date): Promise<boolean> =>
        userRepository.markSessionPasswordVerified(userId, sessionId, at),
};
