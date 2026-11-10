/**
 * 通知のカードに出す操作と 2 行目（通知の種類 → 出すもの）。実行は components/notifications/useNotificationActions.ts。
 * 種類を足したら、ここと lib/notifications.ts（文面・タブ）に足す。
 */
import type { AppNotification } from '@ubichill/shared';
import { messagePreview } from './messages';
import { isExpired } from './notifications';

export type NotificationActionId =
    | 'accept-friend'
    | 'decline-friend'
    | 'approve-follower'
    | 'reject-follower'
    | 'enter'
    | 'accept-invite-request'
    | 'decline-invite-request'
    | 'open-conversation'
    | 'view-profile';

export type NotificationActionTone = 'accept' | 'decline' | 'view' | 'enter';

export const NOTIFICATION_ACTIONS: Readonly<
    Record<NotificationActionId, { label: string; tone: NotificationActionTone }>
> = {
    'accept-friend': { label: '承認する', tone: 'accept' },
    'decline-friend': { label: '拒否する', tone: 'decline' },
    'approve-follower': { label: '承認する', tone: 'accept' },
    'reject-follower': { label: '拒否する', tone: 'decline' },
    enter: { label: '入る', tone: 'enter' },
    'accept-invite-request': { label: '招待する', tone: 'accept' },
    'decline-invite-request': { label: '断る', tone: 'decline' },
    'open-conversation': { label: '会話を開く', tone: 'view' },
    'view-profile': { label: 'プロフィールを見る', tone: 'view' },
};

export interface NotificationContext {
    /** まだ返事をしていないフレンド申請 */
    pendingFollow: boolean;
    now: number;
    /** いま入っている部屋（HUD の外なら null） */
    currentInstanceId: string | null;
    /** ランチパッドの中で開いている（会話はランチパッドに重ねて開くので、外では出さない） */
    inLaunchpad: boolean;
}

/** カードの右に並べる操作（並び順どおり）。 */
export function notificationActionsOf(n: AppNotification, ctx: NotificationContext): NotificationActionId[] {
    const expired = isExpired(n, ctx.now);
    return [
        ...(ctx.pendingFollow ? (['accept-friend', 'decline-friend'] as const) : []),
        ...(n.type === 'FediverseFollowRequest' ? (['approve-follower', 'reject-follower'] as const) : []),
        ...(n.type === 'Invite' && !expired && n.object.id !== ctx.currentInstanceId ? (['enter'] as const) : []),
        ...(n.type === 'Join' && !expired ? (['accept-invite-request', 'decline-invite-request'] as const) : []),
        ...((n.type === 'Create' || n.type === 'EmojiReact') && ctx.inLaunchpad
            ? (['open-conversation'] as const)
            : []),
        ...(n.actor.preferredUsername && n.type !== 'Announce' ? (['view-profile'] as const) : []),
    ];
}

/** 文面の下に出す本文（お知らせ・招待の一言・メッセージの冒頭）。無ければ null。 */
export function notificationDetailOf(n: AppNotification): string | null {
    switch (n.type) {
        case 'Announce':
            return n.object.content;
        case 'Invite':
            return n.content;
        case 'Create':
        case 'EmojiReact':
            return messagePreview(n.object.content, 120);
        default:
            return null;
    }
}
