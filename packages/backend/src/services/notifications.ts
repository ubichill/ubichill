/**
 * 通知を作る規則と、一覧・未読数・既読。DB と配送は注入する（テストでは差し替える）。
 * - 自分の操作は自分に通知しない
 * - 同じ出来事は受け手ごとに 1 つ（dedupeKey）。消えた相手には作らない（DB の外部キーで弾く）
 * - フレンドの関係が消えたら、2 人の間の申請・承認の通知も消す（もう操作できないため。申請し直せば新しく届く）
 */
import type { announcementRepository, notificationRepository } from '@ubichill/db';
import {
    type AppNotification,
    type CreateAnnouncementRequest,
    decodeFeedCursor,
    type MarkReadRequest,
    NOTIFICATION_LIMITS,
    OFFICIAL_HANDLE,
    type StoredNotificationType,
} from '@ubichill/shared';
import type { NotificationHub } from './notificationHub';
import { EVERYONE } from './notificationHub';
import { announcementNotificationOf, mergeFeedPage, notificationOf } from './notificationViews';

type NotificationStore = Pick<
    typeof notificationRepository,
    'create' | 'listPage' | 'countUnread' | 'markRead' | 'markAllRead' | 'markReadByKey' | 'removeBetween'
>;
type AnnouncementStore = Pick<
    typeof announcementRepository,
    'create' | 'listPage' | 'findByIds' | 'readUntil' | 'advanceReadUntil' | 'countAfter'
>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const dedupeKeys = {
    follow: (actorId: string) => `Follow:${actorId}`,
    accept: (actorId: string) => `Accept:${actorId}`,
    like: (actorId: string, worldUrl: string) => `Like:${actorId}:${worldUrl}`,
};

export type FeedResult =
    | { ok: true; items: AppNotification[]; nextCursor: string | null; unreadCount: number }
    | { ok: false; error: 'bad-cursor' };

export type AnnounceResult = { ok: true; notification: AppNotification } | { ok: false; error: 'forbidden' };

export function createNotificationService(deps: {
    notifications: NotificationStore;
    announcements: AnnouncementStore;
    hub: Pick<NotificationHub, 'deliver'>;
    now?: () => Date;
}) {
    const now = deps.now ?? (() => new Date());
    const retentionStart = (): Date => new Date(now().getTime() - NOTIFICATION_LIMITS.RETENTION_DAYS * DAY_MS);

    const notify = async (input: {
        recipientId: string;
        type: StoredNotificationType;
        actorUserId: string;
        object: unknown;
        dedupeKey: string;
    }): Promise<AppNotification | undefined> => {
        if (input.recipientId === input.actorUserId) return undefined;
        const record = await deps.notifications.create(input, now());
        const notification = record ? notificationOf(record) : undefined;
        if (notification) await deps.hub.deliver(input.recipientId, { type: 'notification', notification });
        return notification;
    };

    const announcementReadUntil = async (userId: string): Promise<Date> =>
        (await deps.announcements.readUntil(userId)) ?? now();

    const unreadCount = async (userId: string): Promise<number> => {
        const [own, readUntil] = await Promise.all([
            deps.notifications.countUnread(userId),
            announcementReadUntil(userId),
        ]);
        return own + (await deps.announcements.countAfter(readUntil, retentionStart()));
    };

    return {
        /** from が to にフレンドを申請した。 */
        followRequested: (fromId: string, toId: string) =>
            notify({
                recipientId: toId,
                type: 'Follow',
                actorUserId: fromId,
                object: { type: 'Person', id: toId },
                dedupeKey: dedupeKeys.follow(fromId),
            }),

        /** accepterId が requesterId からの申請を承認した。承認した人の手元の申請の通知は既読にする。 */
        async friendAccepted(accepterId: string, requesterId: string): Promise<AppNotification | undefined> {
            if (accepterId === requesterId) return undefined;
            const read = await deps.notifications.markReadByKey(accepterId, dedupeKeys.follow(requesterId), now());
            if (read.length > 0) await deps.hub.deliver(accepterId, { type: 'read', ids: read });
            return notify({
                recipientId: requesterId,
                type: 'Accept',
                actorUserId: accepterId,
                object: { type: 'Follow', actor: requesterId, object: accepterId },
                dedupeKey: dedupeKeys.accept(accepterId),
            });
        },

        /** 2 人の関係が消えた（解除・取り消し・拒否）。 */
        async friendshipRemoved(a: string, b: string): Promise<void> {
            const removed = await deps.notifications.removeBetween(a, b, ['Follow', 'Accept']);
            const byRecipient = Map.groupBy(removed, (r) => r.recipientId);
            await Promise.all(
                [...byRecipient].map(([recipientId, rows]) =>
                    deps.hub.deliver(recipientId, { type: 'removed', ids: rows.map((r) => r.id) }),
                ),
            );
        },

        /** likerId がワールドをお気に入りにした。作者がこのサーバーのユーザーのときだけ作者に届ける。 */
        worldLiked: (likerId: string, world: { url: string; name: string; authorId: string }) =>
            notify({
                recipientId: world.authorId,
                type: 'Like',
                actorUserId: likerId,
                object: { type: 'World', id: world.url, name: world.name },
                dedupeKey: dedupeKeys.like(likerId, world.url),
            }),

        /** 運営のお知らせを出す。出せるのは公式アカウントだけ。全員の SSE に届ける。 */
        async publishAnnouncement(
            author: { id: string; handle: string | undefined },
            input: CreateAnnouncementRequest,
        ): Promise<AnnounceResult> {
            if (author.handle !== OFFICIAL_HANDLE) return { ok: false, error: 'forbidden' };
            const record = await deps.announcements.create({ authorId: author.id, ...input }, now());
            // 受け手ごとの既読は読むときに合わせる。配る時点では誰にとっても未読
            const notification = announcementNotificationOf(record, new Date(0));
            if (!notification) throw new Error('お知らせを通知の形にできません');
            await deps.hub.deliver(EVERYONE, { type: 'notification', notification });
            return { ok: true, notification };
        },

        async listFeed(userId: string, options: { cursor?: string; limit?: number }): Promise<FeedResult> {
            const before = options.cursor ? decodeFeedCursor(options.cursor) : undefined;
            if (options.cursor && !before) return { ok: false, error: 'bad-cursor' };
            const limit = Math.min(
                Math.max(1, Math.trunc(options.limit ?? NOTIFICATION_LIMITS.DEFAULT_PAGE_SIZE)),
                NOTIFICATION_LIMITS.MAX_PAGE_SIZE,
            );
            const [own, announced, readUntil, count] = await Promise.all([
                deps.notifications.listPage(userId, { before, limit: limit + 1 }),
                deps.announcements.listPage({ since: retentionStart(), before, limit: limit + 1 }),
                announcementReadUntil(userId),
                unreadCount(userId),
            ]);
            const page = mergeFeedPage(
                [
                    own.flatMap((r) => notificationOf(r) ?? []),
                    announced.flatMap((r) => announcementNotificationOf(r, readUntil) ?? []),
                ],
                limit,
            );
            return { ok: true, ...page, unreadCount: count };
        },

        unreadCount,

        /**
         * 既読にする。本人の通知だけが変わる（他人の ID は無視する）。お知らせは既読の位置を進めるので、
         * あるお知らせを既読にすると、それより前のお知らせも既読になる。
         */
        async markRead(userId: string, request: MarkReadRequest): Promise<number> {
            const at = now();
            if ('all' in request) {
                await Promise.all([
                    deps.notifications.markAllRead(userId, at),
                    deps.announcements.advanceReadUntil(userId, at),
                ]);
                await deps.hub.deliver(userId, { type: 'read' });
                return unreadCount(userId);
            }
            const [read, announced] = await Promise.all([
                deps.notifications.markRead(userId, request.ids, at),
                deps.announcements.findByIds(request.ids),
            ]);
            const latest = announced.reduce<Date | undefined>(
                (max, a) => (!max || a.publishedAt > max ? a.publishedAt : max),
                undefined,
            );
            if (latest) await deps.announcements.advanceReadUntil(userId, latest);
            const ids = [...read, ...announced.map((a) => a.id)];
            if (ids.length > 0) await deps.hub.deliver(userId, { type: 'read', ids });
            return unreadCount(userId);
        },
    };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
