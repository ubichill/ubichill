import type { FeedPosition, StoredNotificationType } from '@ubichill/shared';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../index';
import { notifications, remoteActors, users } from '../schema';

/** 通知の行と、actor（このサーバーのユーザー）の表示に要る項目。 */
export interface NotificationRecord {
    id: string;
    recipientId: string;
    type: string;
    actorUserId: string | null;
    actorUri: string | null;
    actorName: string | null;
    actorHandle: string | null;
    actorImage: string | null;
    object: unknown;
    content: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    readAt: Date | null;
}

export interface CreateNotificationInput {
    recipientId: string;
    type: StoredNotificationType;
    /** このサーバーのユーザー（actorUri とどちらか 1 つ） */
    actorUserId?: string;
    /** ほかのサーバーの actor（連合） */
    actorUri?: string;
    object: unknown;
    dedupeKey: string;
    content?: string | null;
    expiresAt?: Date | null;
}

/** actor の表示の情報（このサーバーのユーザーか、ほかのサーバーの actor のキャッシュ）。 */
const selection = {
    id: notifications.id,
    recipientId: notifications.recipientId,
    type: notifications.type,
    actorUserId: notifications.actorUserId,
    actorUri: notifications.actorUri,
    actorName: sql<string | null>`coalesce(${users.name}, ${remoteActors.name}, ${remoteActors.account})`,
    actorHandle: sql<string | null>`coalesce(${users.handle}, ${remoteActors.account})`,
    actorImage: sql<string | null>`coalesce(${users.image}, ${remoteActors.icon})`,
    object: notifications.object,
    content: notifications.content,
    expiresAt: notifications.expiresAt,
    createdAt: notifications.createdAt,
    readAt: notifications.readAt,
};

/** 外部キー違反（相手のユーザーが消えていた）。drizzle は postgres.js のエラーを cause に包む。 */
const isForeignKeyViolation = (err: unknown): boolean => {
    const codeOf = (e: unknown): unknown => (e && typeof e === 'object' && 'code' in e ? e.code : undefined);
    const cause = err && typeof err === 'object' && 'cause' in err ? err.cause : undefined;
    return codeOf(err) === '23503' || codeOf(cause) === '23503';
};

/** (created_at, id) が位置より古い。時刻はミリ秒で書く（カーソルがミリ秒なので、それより細かい値を持たせない）。 */
const olderThan = (p: FeedPosition) =>
    or(
        lt(notifications.createdAt, new Date(p.publishedMs)),
        and(eq(notifications.createdAt, new Date(p.publishedMs)), lt(notifications.id, p.id)),
    );

export const notificationRepository = {
    /**
     * 通知を作る。同じ受け手・同じ dedupeKey の通知があれば作らない（undefined）。受け手か actor が消えていても作らない。
     */
    async create(input: CreateNotificationInput, now = new Date()): Promise<NotificationRecord | undefined> {
        const id = nanoid();
        try {
            const inserted = await db
                .insert(notifications)
                .values({ id, ...input, createdAt: now })
                .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey] })
                .returning({ id: notifications.id });
            if (inserted.length === 0) return undefined;
        } catch (err) {
            if (isForeignKeyViolation(err)) return undefined;
            throw err;
        }
        return notificationRepository.findById(input.recipientId, id);
    },

    async findById(recipientId: string, id: string): Promise<NotificationRecord | undefined> {
        const [row] = await db
            .select(selection)
            .from(notifications)
            .leftJoin(users, eq(users.id, notifications.actorUserId))
            .leftJoin(remoteActors, eq(remoteActors.id, notifications.actorUri))
            .where(and(eq(notifications.recipientId, recipientId), eq(notifications.id, id)));
        return row;
    },

    /** 新しい順。before より古いものだけ。 */
    async listPage(
        recipientId: string,
        options: { before?: FeedPosition; limit: number },
    ): Promise<NotificationRecord[]> {
        return db
            .select(selection)
            .from(notifications)
            .leftJoin(users, eq(users.id, notifications.actorUserId))
            .leftJoin(remoteActors, eq(remoteActors.id, notifications.actorUri))
            .where(
                and(eq(notifications.recipientId, recipientId), options.before ? olderThan(options.before) : undefined),
            )
            .orderBy(desc(notifications.createdAt), desc(notifications.id))
            .limit(options.limit);
    },

    async countUnread(recipientId: string): Promise<number> {
        const [row] = await db
            .select({ n: count() })
            .from(notifications)
            .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
        return row?.n ?? 0;
    },

    /** 本人の通知だけを既読にする。既読にした ID を返す（他人の ID・既読のものは返らない）。 */
    async markRead(recipientId: string, ids: readonly string[], now = new Date()): Promise<string[]> {
        if (ids.length === 0) return [];
        const rows = await db
            .update(notifications)
            .set({ readAt: now })
            .where(
                and(
                    eq(notifications.recipientId, recipientId),
                    inArray(notifications.id, [...ids]),
                    isNull(notifications.readAt),
                ),
            )
            .returning({ id: notifications.id });
        return rows.map((r) => r.id);
    },

    async markAllRead(recipientId: string, now = new Date()): Promise<number> {
        const rows = await db
            .update(notifications)
            .set({ readAt: now })
            .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
            .returning({ id: notifications.id });
        return rows.length;
    },

    /** 受け手の、この dedupeKey の通知を既読にする（申請を承認したら、その申請の通知は読んだことにする）。 */
    async markReadByKey(recipientId: string, dedupeKey: string, now = new Date()): Promise<string[]> {
        const rows = await db
            .update(notifications)
            .set({ readAt: now })
            .where(
                and(
                    eq(notifications.recipientId, recipientId),
                    eq(notifications.dedupeKey, dedupeKey),
                    isNull(notifications.readAt),
                ),
            )
            .returning({ id: notifications.id });
        return rows.map((r) => r.id);
    },

    /** 受け手の、この dedupeKey の通知を消す（送り直した招待を新しく作り直す・答えたリクエストを片付ける）。消した ID。 */
    async removeByKey(recipientId: string, dedupeKey: string): Promise<string[]> {
        const rows = await db
            .delete(notifications)
            .where(and(eq(notifications.recipientId, recipientId), eq(notifications.dedupeKey, dedupeKey)))
            .returning({ id: notifications.id });
        return rows.map((r) => r.id);
    },

    /** このサーバーのユーザーと、ほかのサーバーの actor の間の、この種類の通知を消す（ユーザー側に届いたものだけ）。 */
    async removeFromActorUri(
        recipientId: string,
        actorUri: string,
        types: readonly StoredNotificationType[],
    ): Promise<string[]> {
        const rows = await db
            .delete(notifications)
            .where(
                and(
                    eq(notifications.recipientId, recipientId),
                    eq(notifications.actorUri, actorUri),
                    inArray(notifications.type, [...types]),
                ),
            )
            .returning({ id: notifications.id });
        return rows.map((r) => r.id);
    },

    /** 2 人の間の、この種類の通知を消す（向きは問わない）。消した通知の ID と受け手を返す。 */
    async removeBetween(
        a: string,
        b: string,
        types: readonly StoredNotificationType[],
    ): Promise<Array<{ id: string; recipientId: string }>> {
        return db
            .delete(notifications)
            .where(
                and(
                    inArray(notifications.type, [...types]),
                    or(
                        and(eq(notifications.recipientId, a), eq(notifications.actorUserId, b)),
                        and(eq(notifications.recipientId, b), eq(notifications.actorUserId, a)),
                    ),
                ),
            )
            .returning({ id: notifications.id, recipientId: notifications.recipientId });
    },

    /** 古い通知（cutoff より前）と、1 人あたりの上限を超えた古い通知を消す。消した件数。 */
    async deleteExpired(cutoff: Date, maxPerRecipient: number): Promise<number> {
        const expired = await db
            .delete(notifications)
            .where(lt(notifications.createdAt, cutoff))
            .returning({ id: notifications.id });
        const overflow = await db.execute<{ id: string }>(sql`
            DELETE FROM ${notifications} WHERE ${notifications.id} IN (
                SELECT id FROM (
                    SELECT n.id, row_number() OVER (PARTITION BY n.recipient_id ORDER BY n.created_at DESC, n.id DESC) AS rank
                    FROM ${notifications} n
                    WHERE n.recipient_id IN (
                        SELECT recipient_id FROM ${notifications} GROUP BY recipient_id HAVING count(*) > ${maxPerRecipient}
                    )
                ) ranked WHERE ranked.rank > ${maxPerRecipient}
            ) RETURNING ${notifications.id}`);
        return expired.length + overflow.length;
    },
};
