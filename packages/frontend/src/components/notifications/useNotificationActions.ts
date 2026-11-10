import { type AppNotification, isFullFor } from '@ubichill/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { useOpenUser } from '@/components/social';
import { type NotificationActionId, notificationActionsOf } from '@/lib/notifications/notificationActions';
import { useSession } from '@/lib/session';
import { answerFollower } from '@/lib/social/fediverseApi';
import { acceptInviteRequest, declineInviteRequest } from '@/lib/social/inviteApi';
import { acceptFriend, removeFriend } from '@/lib/social/socialApi';
import { fetchInstance } from '@/lib/worlds/instancesApi';

/** 通知 1 件に出す操作と、その実行（API・画面の移動）。 */
export function useNotificationActions(
    notification: AppNotification,
    {
        pendingFollow,
        onRead,
        onFriendshipChange,
        onNavigate,
    }: { pendingFollow: boolean; onRead: () => void; onFriendshipChange: () => void; onNavigate?: () => void },
) {
    const openUser = useOpenUser(onNavigate);
    const hud = useHudNavigation();
    const navigate = useNavigate();
    const viewerId = useSession().data?.user.id ?? null;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { actor } = notification;

    const act = async (task: () => Promise<unknown>, after?: () => void) => {
        setBusy(true);
        setError(null);
        try {
            await task();
            after?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
        } finally {
            setBusy(false);
        }
    };

    const enter = (instance: { id: string; name: string; image: string | null }) => {
        onRead();
        const worldData = { displayName: instance.name, thumbnail: instance.image ?? undefined };
        if (hud) {
            hud.joinInstance(instance.id, '', worldData);
            return;
        }
        onNavigate?.();
        navigate(`/instance/${encodeURIComponent(instance.id)}`, { state: { worldData } });
    };

    const handlers: Record<NotificationActionId, () => void> = {
        'accept-friend': () => void act(() => acceptFriend(actor.id), onFriendshipChange),
        'decline-friend': () => void act(() => removeFriend(actor.id), onFriendshipChange),
        'approve-follower': () => void act(() => answerFollower(actor.id, 'approve')),
        'reject-follower': () => void act(() => answerFollower(actor.id, 'reject')),
        enter: () => {
            if (notification.type !== 'Invite') return;
            const instance = notification.object;
            // 招待のあとで満員になっていたら、移る前にここで知らせる
            void act(async () => {
                if (isFullFor(await fetchInstance(instance.id), viewerId)) throw new Error('満員です');
                enter(instance);
            });
        },
        'accept-invite-request': () => void act(() => acceptInviteRequest(actor.id), onRead),
        'decline-invite-request': () => void act(() => declineInviteRequest(actor.id)),
        'open-conversation': () => {
            onRead();
            hud?.openConversation(actor.id);
        },
        'view-profile': () => {
            onRead();
            if (actor.preferredUsername) openUser({ id: actor.id, handle: actor.preferredUsername });
        },
    };

    const actions = notificationActionsOf(notification, {
        pendingFollow,
        now: Date.now(),
        currentInstanceId: hud?.currentInstanceId ?? null,
        inLaunchpad: !!hud,
    });
    return { actions, run: (id: NotificationActionId) => handlers[id](), busy, error };
}
