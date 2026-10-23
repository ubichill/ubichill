import type { AppNotification, ServerNotice } from '@ubichill/shared';

/**
 * 通知の種類。通知タブの中のタブに対応する（招待は #199 で足す）。
 */
export type NotificationKind = 'invite' | 'friend-request' | 'other';

/** 通知タブの中のタブ（表示順）。 */
export const NOTIFICATION_TABS: ReadonlyArray<{ kind: NotificationKind; label: string }> = [
    { kind: 'invite', label: '招待' },
    { kind: 'friend-request', label: 'フレンド' },
    { kind: 'other', label: 'その他' },
];

export const kindOf = (n: AppNotification): NotificationKind =>
    n.type === 'Follow' || n.type === 'Accept' ? 'friend-request' : 'other';

/** 種類ごとに分ける（どの種類も空の配列を持つ。並びは保つ）。 */
export function groupNotifications(items: readonly AppNotification[]): Record<NotificationKind, AppNotification[]> {
    return Object.fromEntries(
        NOTIFICATION_TABS.map(({ kind }) => [kind, items.filter((n) => kindOf(n) === kind)]),
    ) as Record<NotificationKind, AppNotification[]>;
}

/** 種類ごとの文面（一覧とトーストで同じもの）。 */
export function notificationText(n: AppNotification): string {
    const who = n.actor.name;
    switch (n.type) {
        case 'Follow':
            return `${who} さんからフレンドリクエストが届きました`;
        case 'Accept':
            return `${who} さんがフレンドリクエストを承認しました`;
        case 'Like':
            return `${who} さんがワールド「${n.object.name}」をお気に入りにしました`;
        case 'Announce':
            return `お知らせ: ${n.object.summary}`;
    }
}

/** ベルの件数（多すぎる数は丸める）。0 なら出さない。 */
export const unreadBadge = (count: number): string | null => (count <= 0 ? null : count > 99 ? '99+' : String(count));

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

/** その場だけの知らせ（インスタンスの `server:notice`）の文面。 */
export function serverNoticeMessage(notice: ServerNotice, now: number): string {
    const seconds = Math.ceil((notice.at - now) / 1000);
    const when =
        seconds >= 60 ? `約 ${Math.round(seconds / 60)} 分後に` : seconds > 0 ? `約 ${seconds} 秒後に` : 'まもなく';
    return `${when}接続が切れます（自動で繋ぎ直します）`;
}
