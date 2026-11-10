/**
 * 通知を作る規則と、一覧・未読数・既読。DB と配送は注入する（テストでは差し替える）。
 * - 自分の操作は自分に通知しない
 * - 同じ出来事は受け手ごとに 1 つ（dedupeKey）。消えた相手には作らない（DB の外部キーで弾く）
 * - フレンドの関係が消えたら、2 人の間の申請・承認の通知も消す（もう操作できないため。申請し直せば新しく届く）
 * - どちらかがブロックしている 2 人の間には作らない。ブロックしたら 2 人の間の通知をすべて消す
 */
import type { announcementRepository, notificationRepository } from '@ubichill/db';
import {
    type AppNotification,
    type CreateAnnouncementRequest,
    decodeFeedCursor,
    isRemoteUserId,
    type MarkReadRequest,
    NOTIFICATION_LIMITS,
    OFFICIAL_HANDLE,
    STORED_NOTIFICATION_TYPES,
    type StoredNotificationType,
} from '@ubichill/shared';
import type { NotificationHub } from './notificationHub';
import { EVERYONE } from './notificationHub';
import { announcementNotificationOf, mergeFeedPage, notificationOf } from './notificationViews';

type NotificationStore = Pick<
    typeof notificationRepository,
    | 'create'
    | 'listPage'
    | 'countUnread'
    | 'markRead'
    | 'markAllRead'
    | 'markReadByKey'
    | 'removeBetween'
    | 'removeByKey'
    | 'removeFromActorUri'
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
    invite: (inviterId: string, instanceId: string) => `Invite:${inviterId}:${instanceId}`,
    inviteRequest: (requesterId: string) => `Join:${requesterId}`,
    fediverseFollow: (actorUri: string) => `FediverseFollow:${actorUri}`,
    fediverseFollowRequest: (actorUri: string) => `FediverseFollowRequest:${actorUri}`,
};

export type FeedResult =
    | { ok: true; items: AppNotification[]; nextCursor: string | null; unreadCount: number }
    | { ok: false; error: 'bad-cursor' };

export type AnnounceResult = { ok: true; notification: AppNotification } | { ok: false; error: 'forbidden' };

export function createNotificationService(deps: {
    notifications: NotificationStore;
    announcements: AnnouncementStore;
    hub: Pick<NotificationHub, 'deliver'>;
    /** 2 人のどちらかがブロックしているか（相手はこのサーバーのユーザー ID か actor の URL） */
    blocked: (recipientId: string, actorId: string) => Promise<boolean>;
    now?: () => Date;
}) {
    const now = deps.now ?? (() => new Date());
    const retentionStart = (): Date => new Date(now().getTime() - NOTIFICATION_LIMITS.RETENTION_DAYS * DAY_MS);

    const notify = async (input: {
        recipientId: string;
        type: StoredNotificationType;
        /** このサーバーのユーザー（actorUri とどちらか 1 つ） */
        actorUserId?: string;
        /** ほかのサーバーの actor（連合） */
        actorUri?: string;
        object: unknown;
        dedupeKey: string;
        content?: string | null;
        expiresAt?: Date;
    }): Promise<AppNotification | undefined> => {
        if (input.recipientId === input.actorUserId) return undefined;
        const actorId = input.actorUserId ?? input.actorUri;
        if (actorId && (await deps.blocked(input.recipientId, actorId))) return undefined;
        const record = await deps.notifications.create(input, now());
        const notification = record ? notificationOf(record) : undefined;
        if (notification) await deps.hub.deliver(input.recipientId, { type: 'notification', notification });
        return notification;
    };

    /** 受け手の、このキーの通知を消して画面にも知らせる。 */
    const removeByKey = async (recipientId: string, dedupeKey: string): Promise<void> => {
        const ids = await deps.notifications.removeByKey(recipientId, dedupeKey);
        if (ids.length > 0) await deps.hub.deliver(recipientId, { type: 'removed', ids });
    };

    /** 送り直したら作り直す（前の通知を消し、未読の新しい通知として届ける）。 */
    const replace = async (input: Parameters<typeof notify>[0]): Promise<AppNotification | undefined> => {
        if (input.recipientId === input.actorUserId) return undefined;
        await removeByKey(input.recipientId, input.dedupeKey);
        return notify(input);
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

        /** 2 人の関係が消えた（解除・取り消し・拒否）。招待・リクエストの通知も、もう使えないので消す。 */
        async friendshipRemoved(a: string, b: string): Promise<void> {
            const removed = await deps.notifications.removeBetween(a, b, ['Follow', 'Accept', 'Invite', 'Join']);
            const byRecipient = Map.groupBy(removed, (r) => r.recipientId);
            await Promise.all(
                [...byRecipient].map(([recipientId, rows]) =>
                    deps.hub.deliver(recipientId, { type: 'removed', ids: rows.map((r) => r.id) }),
                ),
            );
        },

        /** blockerId が otherId（このサーバーのユーザー ID か actor の URL）をブロックした。2 人の間の通知をすべて消す。 */
        async blocked(blockerId: string, otherId: string): Promise<void> {
            const removed = isRemoteUserId(otherId)
                ? (await deps.notifications.removeFromActorUri(blockerId, otherId, STORED_NOTIFICATION_TYPES)).map(
                      (id) => ({ id, recipientId: blockerId }),
                  )
                : await deps.notifications.removeBetween(blockerId, otherId, STORED_NOTIFICATION_TYPES);
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

        /** inviterId が inviteeId を部屋に招待した（送り直すと作り直す）。 */
        invited: (input: {
            inviterId: string;
            inviteeId: string;
            instance: { id: string; name: string; image: string | null };
            message: string | null;
            expiresAt: Date;
        }) =>
            replace({
                recipientId: input.inviteeId,
                type: 'Invite',
                actorUserId: input.inviterId,
                object: { type: 'Instance', ...input.instance },
                dedupeKey: dedupeKeys.invite(input.inviterId, input.instance.id),
                content: input.message,
                expiresAt: input.expiresAt,
            }),

        /** requesterId が targetId に「部屋に入れて」と頼んだ。 */
        inviteRequested: (input: { requesterId: string; targetId: string; expiresAt: Date }) =>
            replace({
                recipientId: input.targetId,
                type: 'Join',
                actorUserId: input.requesterId,
                object: { type: 'Person', id: input.targetId },
                dedupeKey: dedupeKeys.inviteRequest(input.requesterId),
                expiresAt: input.expiresAt,
            }),

        /** targetId がリクエストに答えた（招待した・断った）。答えたリクエストの通知は片付ける。 */
        inviteRequestAnswered: (targetId: string, requesterId: string) =>
            removeByKey(targetId, dedupeKeys.inviteRequest(requesterId)),

        // ── ほかのサーバーの actor から（連合）。dedupeKey は actor の URL で作る（このサーバーのユーザー ID と取り違えない） ──

        /** ほかのサーバーの actor から、フレンドの申請が来た。 */
        remoteFriendRequested: (actorUri: string, userId: string) =>
            notify({
                recipientId: userId,
                type: 'Follow',
                actorUri,
                object: { type: 'Person', id: userId },
                dedupeKey: dedupeKeys.follow(actorUri),
            }),

        /** ほかのサーバーの actor が、こちらの申請を承認した。 */
        remoteFriendAccepted: (actorUri: string, userId: string) =>
            notify({
                recipientId: userId,
                type: 'Accept',
                actorUri,
                object: { type: 'Follow', actor: userId, object: actorUri },
                dedupeKey: dedupeKeys.accept(actorUri),
            }),

        /** こちらがほかのサーバーの actor の申請を承認した（手元の申請の通知は既読にする）。 */
        async remoteFriendshipConfirmed(userId: string, actorUri: string): Promise<void> {
            const read = await deps.notifications.markReadByKey(userId, dedupeKeys.follow(actorUri), now());
            if (read.length > 0) await deps.hub.deliver(userId, { type: 'read', ids: read });
        },

        /** ほかのサーバーの actor との関係が消えた。2 人の間の申請・承認・招待・リクエストの通知を消す。 */
        async remoteFriendshipRemoved(userId: string, actorUri: string): Promise<void> {
            const ids = await deps.notifications.removeFromActorUri(userId, actorUri, [
                'Follow',
                'Accept',
                'Invite',
                'Join',
            ]);
            if (ids.length > 0) await deps.hub.deliver(userId, { type: 'removed', ids });
        },

        /** フェディバース（Mastodon・Misskey など）の actor がフォローした。 */
        fediverseFollowed: (actorUri: string, userId: string) =>
            notify({
                recipientId: userId,
                type: 'FediverseFollow',
                actorUri,
                object: { type: 'Person', id: userId },
                dedupeKey: dedupeKeys.fediverseFollow(actorUri),
            }),

        /** フェディバースの actor がフォローを申請した（承認制のユーザー。申請し直したら作り直す）。 */
        fediverseFollowRequested: (actorUri: string, userId: string) =>
            replace({
                recipientId: userId,
                type: 'FediverseFollowRequest',
                actorUri,
                object: { type: 'Person', id: userId },
                dedupeKey: dedupeKeys.fediverseFollowRequest(actorUri),
            }),

        /** フォローの申請が片付いた（承認・拒否・取り下げ）。もう操作できないので申請の通知を消す。 */
        fediverseFollowSettled: (userId: string, actorUri: string) =>
            removeByKey(userId, dedupeKeys.fediverseFollowRequest(actorUri)),

        /**
         * 連合の招待が届いた: ほかのサーバーの actor からの招待か、このサーバーの人がほかのサーバーの部屋へ招待した。
         * object の id は画面の部屋の住所（このサーバーの部屋は ID、ほかは `<ID>@<ドメイン>`）。
         */
        remoteInvited: (input: {
            from: { userId: string } | { actorUri: string };
            inviteeId: string;
            room: { address: string; url: string; name: string; image: string | null };
            message: string | null;
            expiresAt: Date;
        }) =>
            replace({
                recipientId: input.inviteeId,
                type: 'Invite',
                ...('userId' in input.from ? { actorUserId: input.from.userId } : { actorUri: input.from.actorUri }),
                object: { type: 'Instance', id: input.room.address, name: input.room.name, image: input.room.image },
                dedupeKey: dedupeKeys.invite(
                    'userId' in input.from ? input.from.userId : input.from.actorUri,
                    input.room.url,
                ),
                content: input.message,
                expiresAt: input.expiresAt,
            }),

        /** ほかのサーバーの actor から、リクエストインバイトが来た。 */
        remoteInviteRequested: (input: { actorUri: string; targetId: string; expiresAt: Date }) =>
            replace({
                recipientId: input.targetId,
                type: 'Join',
                actorUri: input.actorUri,
                object: { type: 'Person', id: input.targetId },
                dedupeKey: dedupeKeys.inviteRequest(input.actorUri),
                expiresAt: input.expiresAt,
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
