/**
 * DB の行 → API の通知（AS2 の形）。どれも純粋な関数で、形が shared のスキーマに合わない行は出さない。
 */
import type { AnnouncementRecord, NotificationRecord } from '@ubichill/db';
import {
    type AppNotification,
    encodeFeedCursor,
    feedPositionOf,
    isNotificationType,
    NotificationSchema,
    sortFeed,
} from '@ubichill/shared';

/** 作者が消えたお知らせの actor（運営の名義）。 */
const OPERATOR_ACTOR = {
    type: 'Person',
    id: 'ubichill',
    name: 'Ubichill',
    preferredUsername: null,
    icon: null,
} as const;

export function notificationOf(record: NotificationRecord): AppNotification | undefined {
    if (!isNotificationType(record.type)) return undefined;
    // actor の行が無い（消えた直後の読み取り）・リモートの actor（まだ表示の情報を持たない）は出さない
    if (!record.actorUserId || record.actorName === null) return undefined;
    const parsed = NotificationSchema.safeParse({
        id: record.id,
        type: record.type,
        actor: {
            type: 'Person',
            id: record.actorUserId,
            name: record.actorName,
            preferredUsername: record.actorHandle,
            icon: record.actorImage,
        },
        object: record.object,
        published: record.createdAt.toISOString(),
        read: record.readAt !== null,
    });
    return parsed.success ? parsed.data : undefined;
}

/** お知らせを、読む人の既読の位置に合わせた通知にする（位置以前に出したものは既読）。 */
export function announcementNotificationOf(record: AnnouncementRecord, readUntil: Date): AppNotification | undefined {
    const actor =
        record.authorId && record.authorName
            ? {
                  type: 'Person',
                  id: record.authorId,
                  name: record.authorName,
                  preferredUsername: record.authorHandle,
                  icon: record.authorImage,
              }
            : OPERATOR_ACTOR;
    const parsed = NotificationSchema.safeParse({
        id: record.id,
        type: 'Announce',
        actor,
        object: { type: 'Note', id: record.id, summary: record.title, content: record.content },
        published: record.publishedAt.toISOString(),
        read: record.publishedAt.getTime() <= readUntil.getTime(),
    });
    return parsed.success ? parsed.data : undefined;
}

/**
 * 2 つの並び（通知とお知らせ。どちらも新しい順に limit + 1 件まで読んだもの）を 1 ページにまとめる。
 * どちらかに limit を超える分があるか、合わせて limit を超えれば次がある。
 */
export function mergeFeedPage(
    sources: ReadonlyArray<readonly AppNotification[]>,
    limit: number,
): { items: AppNotification[]; nextCursor: string | null } {
    const merged = sortFeed(sources.flat());
    const items = merged.slice(0, limit);
    const last = items.at(-1);
    return { items, nextCursor: merged.length > limit && last ? encodeFeedCursor(feedPositionOf(last)) : null };
}
