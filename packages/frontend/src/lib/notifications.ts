import type { FriendRequestSummary } from '@ubichill/shared';

/**
 * 通知の種類。通知タブの中のタブに対応する。種類を増やすときはここに足す（招待は #199、その他はメッセージなど #198）。
 */
export type NotificationKind = 'invite' | 'friend-request' | 'other';

export type AppNotification = { kind: 'friend-request'; id: string; at: string; from: FriendRequestSummary };

/** 通知タブの中のタブ（表示順）。 */
export const NOTIFICATION_TABS: ReadonlyArray<{ kind: NotificationKind; label: string }> = [
    { kind: 'invite', label: '招待' },
    { kind: 'friend-request', label: 'フレンドリクエスト' },
    { kind: 'other', label: 'その他' },
];

/** いま手元にある情報源から通知を作る（新しい順）。 */
export function notificationsFrom(sources: {
    incomingFriendRequests: readonly FriendRequestSummary[];
}): AppNotification[] {
    return sources.incomingFriendRequests
        .map(
            (from): AppNotification => ({
                kind: 'friend-request',
                id: `friend-request:${from.id}`,
                at: from.requestedAt,
                from,
            }),
        )
        .sort((a, b) => b.at.localeCompare(a.at));
}

/** 種類ごとに分ける（どの種類も空の配列を持つ）。 */
export function groupNotifications(items: readonly AppNotification[]): Record<NotificationKind, AppNotification[]> {
    const kinds = NOTIFICATION_TABS.map((t) => t.kind);
    return Object.fromEntries(
        kinds.map((kind) => [kind, items.filter((n) => (n.kind as NotificationKind) === kind)]),
    ) as Record<NotificationKind, AppNotification[]>;
}

/** 「数秒前」「3 分前」「2 時間前」「5 日前」。未来の時刻（時計のずれ）は「数秒前」。 */
export function relativeTime(iso: string, now: number): string {
    const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
    if (seconds < 60) return '数秒前';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 時間前`;
    return `${Math.floor(hours / 24)} 日前`;
}
