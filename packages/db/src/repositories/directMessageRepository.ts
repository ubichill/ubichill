import type { FeedPosition } from '@ubichill/shared';
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../index';
import { directMessageReactions, directMessages } from '../schema';

export interface DirectMessageRecord {
    id: string;
    senderId: string;
    recipientId: string;
    content: string;
    createdAt: Date;
}

export interface MessageReactionRecord {
    messageId: string;
    userId: string;
    emoji: string;
}

export interface ConversationRecord {
    /** 相手のユーザー ID */
    peerId: string;
    last: DirectMessageRecord;
    unreadCount: number;
}

const selection = {
    id: directMessages.id,
    senderId: directMessages.senderId,
    recipientId: directMessages.recipientId,
    content: directMessages.content,
    createdAt: directMessages.createdAt,
};

/** a と b の間の行（向きは問わない）。 */
const between = (a: string, b: string) =>
    or(
        and(eq(directMessages.senderId, a), eq(directMessages.recipientId, b)),
        and(eq(directMessages.senderId, b), eq(directMessages.recipientId, a)),
    );

/** (created_at, id) が位置より古い。時刻はミリ秒で書く（カーソルがミリ秒なので、それより細かい値を持たせない）。 */
const olderThan = (p: FeedPosition) =>
    or(
        lt(directMessages.createdAt, new Date(p.publishedMs)),
        and(eq(directMessages.createdAt, new Date(p.publishedMs)), lt(directMessages.id, p.id)),
    );

/** フレンド同士のメッセージの保存。送れるかは呼ぶ側（backend の services/social/messages.ts）が決める。 */
export const directMessageRepository = {
    async create(
        input: { senderId: string; recipientId: string; content: string },
        now = new Date(),
    ): Promise<DirectMessageRecord> {
        const [row] = await db
            .insert(directMessages)
            .values({ id: nanoid(), ...input, createdAt: now })
            .returning(selection);
        if (!row) throw new Error('メッセージを保存できませんでした');
        return row;
    },

    /** 2 人の間のメッセージ（新しい順）。before より古いものだけ。 */
    async listBetween(
        a: string,
        b: string,
        options: { before?: FeedPosition; limit: number },
    ): Promise<DirectMessageRecord[]> {
        return db
            .select(selection)
            .from(directMessages)
            .where(and(between(a, b), options.before ? olderThan(options.before) : undefined))
            .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
            .limit(options.limit);
    },

    /** 会話の一覧（相手ごとに最新の 1 通と未読の数。新しい順に limit 件）。 */
    async conversationsOf(userId: string, limit: number): Promise<ConversationRecord[]> {
        // 組のキーに userId の値を混ぜない（DISTINCT ON と ORDER BY で別の引数になると同じ式とみなされない）
        const low = sql`least(${directMessages.senderId}, ${directMessages.recipientId})`;
        const high = sql`greatest(${directMessages.senderId}, ${directMessages.recipientId})`;
        const [latest, unread] = await Promise.all([
            db
                .selectDistinctOn([low, high], selection)
                .from(directMessages)
                .where(or(eq(directMessages.senderId, userId), eq(directMessages.recipientId, userId)))
                .orderBy(low, high, desc(directMessages.createdAt), desc(directMessages.id)),
            db
                .select({ senderId: directMessages.senderId, n: count() })
                .from(directMessages)
                .where(and(eq(directMessages.recipientId, userId), isNull(directMessages.readAt)))
                .groupBy(directMessages.senderId),
        ]);
        const unreadBy = new Map(unread.map((r) => [r.senderId, r.n]));
        return latest
            .toSorted((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1))
            .slice(0, limit)
            .map((last) => {
                const peerId = last.senderId === userId ? last.recipientId : last.senderId;
                return { peerId, last, unreadCount: unreadBy.get(peerId) ?? 0 };
            });
    },

    /** sender から recipient に届いた未読を既読にする。既読にした数。 */
    async markReadFrom(recipientId: string, senderId: string, now = new Date()): Promise<number> {
        const rows = await db
            .update(directMessages)
            .set({ readAt: now })
            .where(
                and(
                    eq(directMessages.recipientId, recipientId),
                    eq(directMessages.senderId, senderId),
                    isNull(directMessages.readAt),
                ),
            )
            .returning({ id: directMessages.id });
        return rows.length;
    },

    async findById(id: string): Promise<DirectMessageRecord | undefined> {
        const [row] = await db.select(selection).from(directMessages).where(eq(directMessages.id, id)).limit(1);
        return row;
    },

    /** メッセージたちのリアクション（付けた順。付け直したものはその時刻）。 */
    async reactionsOf(messageIds: readonly string[]): Promise<MessageReactionRecord[]> {
        if (messageIds.length === 0) return [];
        return db
            .select({
                messageId: directMessageReactions.messageId,
                userId: directMessageReactions.userId,
                emoji: directMessageReactions.emoji,
            })
            .from(directMessageReactions)
            .where(inArray(directMessageReactions.messageId, [...messageIds]))
            .orderBy(asc(directMessageReactions.createdAt), asc(directMessageReactions.userId));
    },

    /** userId のリアクションを emoji にする（1 人 1 つなので、付けていれば置き換える）。 */
    async setReaction(messageId: string, userId: string, emoji: string, now = new Date()): Promise<void> {
        await db
            .insert(directMessageReactions)
            .values({ messageId, userId, emoji, createdAt: now })
            .onConflictDoUpdate({
                target: [directMessageReactions.messageId, directMessageReactions.userId],
                set: { emoji, createdAt: now },
            });
    },

    /** userId のリアクションを外す。外したら true。 */
    async removeReaction(messageId: string, userId: string): Promise<boolean> {
        const rows = await db
            .delete(directMessageReactions)
            .where(and(eq(directMessageReactions.messageId, messageId), eq(directMessageReactions.userId, userId)))
            .returning({ messageId: directMessageReactions.messageId });
        return rows.length > 0;
    },

    /** cutoff より前のメッセージを消す。消した件数。 */
    async deleteExpired(cutoff: Date): Promise<number> {
        const rows = await db
            .delete(directMessages)
            .where(lt(directMessages.createdAt, cutoff))
            .returning({ id: directMessages.id });
        return rows.length;
    },
};
