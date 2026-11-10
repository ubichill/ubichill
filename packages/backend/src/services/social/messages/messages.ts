/**
 * フレンド同士のメッセージ。送れるかは shared の messageRefusal で決め、ここは関係を集めて規則に渡し、保存と通知をする。
 * DB・フレンド・通知は注入する。
 * - 送れるのは今フレンドの相手だけ。フレンドでなくなっても、過去の会話は読める（送れない理由を添える）
 * - 会話を読むと、相手から届いた分とその会話の通知を既読にする
 * - リアクションも送るのと同じ規則（いまフレンドの相手との会話の 1 通だけ。自分と相手どちらのメッセージにも付けられる）
 */
import type { ConversationRecord, DirectMessageRecord, MessageReactionRecord } from '@ubichill/db';
import {
    type ConversationSummary,
    type DirectMessage,
    type DirectMessageBody,
    decodeFeedCursor,
    encodeFeedCursor,
    feedPositionOf,
    MESSAGE_LIMITS,
    type MessageReaction,
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
        findById(id: string): Promise<DirectMessageRecord | undefined>;
        reactionsOf(messageIds: readonly string[]): Promise<MessageReactionRecord[]>;
        setReaction(messageId: string, userId: string, emoji: string, now: Date): Promise<void>;
        removeReaction(messageId: string, userId: string): Promise<boolean>;
    };
    areFriends(a: string, b: string): Promise<boolean>;
    /** どちらかがもう片方をブロックしているか */
    isBlockedBetween(a: string, b: string): Promise<boolean>;
    /** userId から見えなくする人（userId がブロックした人）。会話の一覧と会話から外す */
    hiddenIdsFor(userId: string): Promise<ReadonlySet<string>>;
    summariesOf(ids: readonly string[]): Promise<UserSummary[]>;
    notify: {
        messageReceived(input: {
            senderId: string;
            recipientId: string;
            message: { id: string; content: string };
        }): Promise<unknown>;
        messagesRead(recipientId: string, senderId: string): Promise<unknown>;
        /** 自分のメッセージに相手がリアクションした（自分で自分のものに付けたときは呼ばない） */
        messageReacted(input: {
            reactorId: string;
            recipientId: string;
            message: { id: string; content: string };
            emoji: string;
        }): Promise<unknown>;
        /** 会話の 2 人の画面にリアクションの変化を流す（通知ではない） */
        reactionsChanged(userIds: readonly string[], messageId: string, reactions: MessageReaction[]): Promise<unknown>;
    };
    /** 通知の失敗で送信を失敗にしない（本番はログに残して捨てる） */
    background(task: Promise<unknown>, what: string): void;
    now(): Date;
}

export const messageBodyOf = (r: DirectMessageRecord): DirectMessageBody => ({
    id: r.id,
    senderId: r.senderId,
    content: r.content,
    published: r.createdAt.toISOString(),
});

const reactionOf = (r: MessageReactionRecord): MessageReaction => ({ userId: r.userId, emoji: r.emoji });

/** 行とリアクションを合わせる（リアクションは付けた順のまま）。 */
export const directMessagesOf = (
    records: readonly DirectMessageRecord[],
    reactions: readonly MessageReactionRecord[],
): DirectMessage[] =>
    records.map((r) => ({
        ...messageBodyOf(r),
        reactions: reactions.filter((x) => x.messageId === r.id).map(reactionOf),
    }));

export type SendOutcome = { ok: true; message: DirectMessage } | { ok: false; reason: MessageRefusal };

export type ReactOutcome =
    | { ok: true; reactions: MessageReaction[] }
    | { ok: false; reason: MessageRefusal }
    | { ok: false; error: 'not-found' };

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
        const pre = messageRefusal(senderId, recipientId, { friends: true, blocked: false });
        if (pre) return pre;
        const [friends, blocked] = await Promise.all([
            deps.areFriends(senderId, recipientId),
            deps.isBlockedBetween(senderId, recipientId),
        ]);
        return messageRefusal(senderId, recipientId, { friends, blocked });
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
            return { ok: true, message: { ...messageBodyOf(record), reactions: [] } };
        },

        /** 会話の一覧（相手が消えた会話・ブロックした人との会話は出さない）。 */
        async conversations(userId: string): Promise<ConversationSummary[]> {
            const [all, hidden] = await Promise.all([
                deps.messages.conversationsOf(userId, MESSAGE_LIMITS.MAX_CONVERSATIONS),
                deps.hiddenIdsFor(userId),
            ]);
            const records = all.filter((r) => !hidden.has(r.peerId));
            const users = new Map((await deps.summariesOf(records.map((r) => r.peerId))).map((u) => [u.id, u]));
            return records.flatMap((r) => {
                const user = users.get(r.peerId);
                return user ? [{ user, last: messageBodyOf(r.last), unreadCount: r.unreadCount }] : [];
            });
        },

        /** 会話の 1 ページ（新しい順）。相手がいない・ブロックした人なら not-found。 */
        async conversation(
            userId: string,
            peerId: string,
            options: { cursor?: string; limit?: number },
        ): Promise<ConversationOutcome> {
            const before = options.cursor ? decodeFeedCursor(options.cursor) : undefined;
            if (options.cursor && !before) return { ok: false, error: 'bad-cursor' };
            const [[user], hidden] = await Promise.all([deps.summariesOf([peerId]), deps.hiddenIdsFor(userId)]);
            if (!user || userId === peerId || hidden.has(peerId)) return { ok: false, error: 'not-found' };
            const limit = pageSizeOf(options.limit);
            const [rows, refusal] = await Promise.all([
                deps.messages.listBetween(userId, peerId, { before, limit: limit + 1 }),
                refusalBetween(userId, peerId),
            ]);
            const page = rows.slice(0, limit);
            const messages = directMessagesOf(page, await deps.messages.reactionsOf(page.map((r) => r.id)));
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

        /**
         * peerId との会話の messageId に、userId のリアクションを emoji にする（null なら外す）。
         * 会話に無い 1 通は not-found（ほかの人の会話の id を当てても、あるかどうかを漏らさない）。
         */
        async react(userId: string, peerId: string, messageId: string, emoji: string | null): Promise<ReactOutcome> {
            const message = await deps.messages.findById(messageId);
            const inConversation =
                message &&
                ((message.senderId === userId && message.recipientId === peerId) ||
                    (message.senderId === peerId && message.recipientId === userId));
            if (!message || !inConversation) return { ok: false, error: 'not-found' };
            const refusal = await refusalBetween(userId, peerId);
            if (refusal) return { ok: false, reason: refusal };

            const current = (await deps.messages.reactionsOf([messageId])).map(reactionOf);
            const mine = current.find((r) => r.userId === userId)?.emoji ?? null;
            // 同じものを付け直す・付けていないものを外すのは何もしない（通知を作り直さない）
            if (mine === emoji) return { ok: true, reactions: current };

            if (emoji) await deps.messages.setReaction(messageId, userId, emoji, deps.now());
            else await deps.messages.removeReaction(messageId, userId);
            const reactions = (await deps.messages.reactionsOf([messageId])).map(reactionOf);
            deps.background(deps.notify.reactionsChanged([userId, peerId], messageId, reactions), 'リアクション');
            if (emoji && message.senderId !== userId) {
                deps.background(
                    deps.notify.messageReacted({
                        reactorId: userId,
                        recipientId: message.senderId,
                        message: { id: message.id, content: message.content },
                        emoji,
                    }),
                    'リアクション',
                );
            }
            return { ok: true, reactions };
        },
    };
}

export type MessageService = ReturnType<typeof createMessageService>;
