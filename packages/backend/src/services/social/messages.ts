/**
 * フレンド同士のメッセージ。送れるかは shared の messageRefusal で決め、ここは関係を集めて規則に渡し、保存と通知をする。
 * DB・フレンド・通知は注入する。
 * - 送れるのは今フレンドの相手だけ。フレンドでなくなっても、過去の会話は読める（送れない理由を添える）
 * - 会話を読むと、相手から届いた分とその会話の通知を既読にする
 */
import type { ConversationRecord, DirectMessageRecord } from '@ubichill/db';
import {
    type ConversationSummary,
    type DirectMessage,
    decodeFeedCursor,
    encodeFeedCursor,
    feedPositionOf,
    MESSAGE_LIMITS,
    type MessageRefusal,
    messageRefusal,
    type UserSummary,
} from '@ubichill/shared';

export interface MessageServiceDeps {
    messages: {
        create(
            input: { senderId: string; recipientId: string; content: string },
            now: Date,
        ): Promise<DirectMessageRecord>;
        listBetween(
            a: string,
            b: string,
            options: { before?: { publishedMs: number; id: string }; limit: number },
        ): Promise<DirectMessageRecord[]>;
        conversationsOf(userId: string, limit: number): Promise<ConversationRecord[]>;
        markReadFrom(recipientId: string, senderId: string, now: Date): Promise<number>;
    };
    areFriends(a: string, b: string): Promise<boolean>;
    summariesOf(ids: readonly string[]): Promise<UserSummary[]>;
    notify: {
        messageReceived(input: {
            senderId: string;
            recipientId: string;
            message: { id: string; content: string };
        }): Promise<unknown>;
        messagesRead(recipientId: string, senderId: string): Promise<unknown>;
    };
    /** 通知の失敗で送信を失敗にしない（本番はログに残して捨てる） */
    background(task: Promise<unknown>, what: string): void;
    now(): Date;
}

export const directMessageOf = (r: DirectMessageRecord): DirectMessage => ({
    id: r.id,
    senderId: r.senderId,
    content: r.content,
    published: r.createdAt.toISOString(),
});

export type SendOutcome = { ok: true; message: DirectMessage } | { ok: false; reason: MessageRefusal };

export type ConversationOutcome =
    | {
          ok: true;
          user: UserSummary;
          messages: DirectMessage[];
          nextCursor: string | null;
          refusal: MessageRefusal | null;
      }
    | { ok: false; error: 'bad-cursor' | 'not-found' };

/** ページの件数をそろえる（数でない・範囲外は既定・上限に寄せる）。 */
export const pageSizeOf = (limit: number | undefined): number =>
    limit === undefined || !Number.isFinite(limit)
        ? MESSAGE_LIMITS.DEFAULT_PAGE_SIZE
        : Math.min(Math.max(1, Math.trunc(limit)), MESSAGE_LIMITS.MAX_PAGE_SIZE);

export function createMessageService(deps: MessageServiceDeps) {
    const refusalBetween = async (senderId: string, recipientId: string): Promise<MessageRefusal | null> => {
        const pre = messageRefusal(senderId, recipientId, { friends: true });
        if (pre) return pre;
        return messageRefusal(senderId, recipientId, { friends: await deps.areFriends(senderId, recipientId) });
    };

    return {
        refusalBetween,

        /** 送る。本文は SendMessageRequestSchema で正規化したもの。 */
        async send(senderId: string, recipientId: string, content: string): Promise<SendOutcome> {
            const refusal = await refusalBetween(senderId, recipientId);
            if (refusal) return { ok: false, reason: refusal };
            const record = await deps.messages.create({ senderId, recipientId, content }, deps.now());
            deps.background(
                deps.notify.messageReceived({
                    senderId,
                    recipientId,
                    message: { id: record.id, content: record.content },
                }),
                'メッセージ',
            );
            return { ok: true, message: directMessageOf(record) };
        },

        /** 会話の一覧（相手が消えた会話は出さない）。 */
        async conversations(userId: string): Promise<ConversationSummary[]> {
            const records = await deps.messages.conversationsOf(userId, MESSAGE_LIMITS.MAX_CONVERSATIONS);
            const users = new Map((await deps.summariesOf(records.map((r) => r.peerId))).map((u) => [u.id, u]));
            return records.flatMap((r) => {
                const user = users.get(r.peerId);
                return user ? [{ user, last: directMessageOf(r.last), unreadCount: r.unreadCount }] : [];
            });
        },

        /** 会話の 1 ページ（新しい順）。相手がいなければ not-found。 */
        async conversation(
            userId: string,
            peerId: string,
            options: { cursor?: string; limit?: number },
        ): Promise<ConversationOutcome> {
            const before = options.cursor ? decodeFeedCursor(options.cursor) : undefined;
            if (options.cursor && !before) return { ok: false, error: 'bad-cursor' };
            const [user] = await deps.summariesOf([peerId]);
            if (!user || userId === peerId) return { ok: false, error: 'not-found' };
            const limit = pageSizeOf(options.limit);
            const [rows, refusal] = await Promise.all([
                deps.messages.listBetween(userId, peerId, { before, limit: limit + 1 }),
                refusalBetween(userId, peerId),
            ]);
            const messages = rows.slice(0, limit).map(directMessageOf);
            const last = messages.at(-1);
            return {
                ok: true,
                user,
                messages,
                nextCursor: rows.length > limit && last ? encodeFeedCursor(feedPositionOf(last)) : null,
                refusal,
            };
        },

        /** peerId から届いた分を読んだ。会話の通知も既読にする。 */
        async markRead(userId: string, peerId: string): Promise<number> {
            const read = await deps.messages.markReadFrom(userId, peerId, deps.now());
            // 通知だけ未読で残ることがある（ほかの端末で読んだ・通知の作成が遅れた）ので、数に関わらず揃える
            await deps.notify.messagesRead(userId, peerId);
            return read;
        },
    };
}

export type MessageService = ReturnType<typeof createMessageService>;
