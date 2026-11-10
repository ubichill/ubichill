import { INVITE_REFUSAL_MESSAGES } from '@ubichill/shared';
import { useCallback } from 'react';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { requestInvite, sendInvites } from '@/lib/social/inviteApi';
import { pushToast } from '@/lib/toast';

/**
 * フレンド 1 人への「招待」（今いる部屋へ）と「リクエスト」（その人のいる部屋に入れてもらう）。
 * 招待はランチパッドの中（部屋にいる）ときだけ。結果はトーストで知らせ、成功したかを返す。
 */
export function useInviteActions() {
    const hud = useHudNavigation();
    const currentInstanceId = hud?.currentInstanceId;

    const invite = useCallback(
        async (user: { id: string }): Promise<boolean> => {
            if (!currentInstanceId) return false;
            try {
                const { results } = await sendInvites(currentInstanceId, { userIds: [user.id] });
                const result = results[0];
                if (result?.ok) {
                    pushToast('招待を送りました');
                    return true;
                }
                pushToast(result ? INVITE_REFUSAL_MESSAGES[result.reason] : '招待を送れませんでした', 'error');
            } catch (e: unknown) {
                pushToast(e instanceof Error ? e.message : '招待を送れませんでした', 'error');
            }
            return false;
        },
        [currentInstanceId],
    );

    const request = useCallback(async (user: { id: string }): Promise<boolean> => {
        try {
            const { alreadyRequested } = await requestInvite(user.id);
            pushToast(alreadyRequested ? 'もうリクエストしています' : 'リクエストを送りました');
            return true;
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : 'リクエストを送れませんでした', 'error');
            return false;
        }
    }, []);

    return { canInvite: currentInstanceId !== undefined, currentInstanceId, invite, request };
}
