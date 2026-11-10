/**
 * フレンド同士のメッセージ（1 対 1）。送れるか・本文の形・上限は backend と frontend で同じ規則を使う。
 * 届いたことは通知（notification/activity.ts の Create）にも載せる。
 */
import { z } from 'zod';
import { isRemoteUserId, type UserSummary } from './friends';
import type { MessageReaction } from './messageReactions';

export const MESSAGE_LIMITS = {
    /** 本文の最大文字数（正規化したあとのコードポイント数） */
    CONTENT_MAX: 500,
    /** 残す日数（通知の NOTIFICATION_LIMITS.RETENTION_DAYS と同じ。これより古いものは掃除する） */
    RETENTION_DAYS: 90,
    /** 1 分に送れる数（1 人あたり。相手は問わない） */
    SEND_PER_MINUTE: 20,
    /** 1 時間に送れる数（1 人あたり） */
    SEND_PER_HOUR: 300,
    /** 会話の 1 ページの件数 */
    DEFAULT_PAGE_SIZE: 30,
    MAX_PAGE_SIZE: 50,
    /** 会話の一覧に出す数（新しい順） */
    MAX_CONVERSATIONS: 50,
} as const;

/** 送れない理由（判定は messageRefusal に集める）。 */
export type MessageRefusal =
    /** 自分自身 */
    | 'self'
    /** ほかのサーバーの人（連合のメッセージはまだ無い） */
    | 'remote'
    /** 承認済みのフレンドでない（申請中・解除した・いない人） */
    | 'not-friend'
    /** どちらかがもう片方をブロックしている */
    | 'blocked';

export const MESSAGE_REFUSAL_MESSAGES: Record<MessageRefusal, string> = {
    self: '自分には送れません',
    remote: 'ほかのサーバーの人にはまだ送れません',
    'not-friend': 'フレンドにだけ送れます',
    // ブロックされた人にブロックを明かさない（フレンドでないときと同じ文言）
    blocked: 'フレンドにだけ送れます',
};

/** 送る人と相手の関係（集めるのは backend。足す条件はここに項目を増やす）。 */
export interface MessageRelation {
    /** 承認済みのフレンドか */
    friends: boolean;
    /** どちらかがもう片方をブロックしている */
    blocked: boolean;
}

/** sender が recipient にメッセージを送れるか。送れれば null。 */
export function messageRefusal(
    senderId: string,
    recipientId: string,
    relation: MessageRelation,
): MessageRefusal | null {
    if (senderId === recipientId) return 'self';
    if (isRemoteUserId(recipientId) || isRemoteUserId(senderId)) return 'remote';
    if (relation.blocked) return 'blocked';
    if (!relation.friends) return 'not-friend';
    return null;
}

// ── 本文 ──────────────────────────────────────────────────

/** 見た目を偽る向きの制御（RLO など）。名前や URL を逆さに見せられるので本文から除く。 */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
/** 幅の無い文字。ZWJ（絵文字の組み合わせ）は残すので、空かどうかの判定にだけ使う。 */
const INVISIBLE = /[\s​-‍⁠﻿]/g;

/** 保存する形にそろえる: 改行は LF・前後の空白を除く・向きの制御を除く。 */
export const normalizeMessageContent = (value: string): string =>
    value.replace(/\r\n?/g, '\n').replace(BIDI_CONTROLS, '').trim();

/** 本文の文字数（保存される形のコードポイント数）。画面のカウンタと API の上限は必ずこれで数える。 */
export const messageLength = (value: string): number => Array.from(normalizeMessageContent(value)).length;

const hasControl = (value: string): boolean =>
    Array.from(value.replace(/[\n\t]/g, '')).some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || (code >= 0x7f && code < 0xa0);
    });

/** 本文（プレーンテキスト。改行は使える）。見えない文字だけのものは空として断る。 */
export const MessageContentSchema = z
    .string()
    .transform(normalizeMessageContent)
    .refine((v) => v.replace(INVISIBLE, '') !== '', 'メッセージを入力してください')
    .refine(
        (v) => Array.from(v).length <= MESSAGE_LIMITS.CONTENT_MAX,
        `メッセージは ${MESSAGE_LIMITS.CONTENT_MAX} 文字以内です`,
    )
    .refine((v) => !hasControl(v), 'メッセージに制御文字は使えません');

// ── API の形 ──────────────────────────────────────────────

/** `POST /api/v1/messages/:userId` */
export const SendMessageRequestSchema = z.object({ content: MessageContentSchema }).strict();
export type SendMessageRequest = z.input<typeof SendMessageRequestSchema>;

/** 1 通の中身。既読かどうかは送った人には見せない（既読を気にさせない）ので持たせない。 */
export interface DirectMessageBody {
    id: string;
    senderId: string;
    content: string;
    /** 送った時刻（ISO 8601） */
    published: string;
}

/** 会話の中の 1 通。 */
export interface DirectMessage extends DirectMessageBody {
    reactions: MessageReaction[];
}

/** 会話の一覧の 1 件。 */
export interface ConversationSummary {
    user: UserSummary;
    last: DirectMessageBody;
    /** 相手から届いて、まだ読んでいない数 */
    unreadCount: number;
}

/** `GET /api/v1/messages` */
export interface ConversationsResponse {
    conversations: ConversationSummary[];
}

/** `GET /api/v1/messages/:userId`（新しい順の 1 ページ） */
export interface ConversationPage {
    user: UserSummary;
    messages: DirectMessage[];
    nextCursor: string | null;
    /** いま送れなければ理由（過去の分は読める） */
    refusal: MessageRefusal | null;
}

/** 会話の中の並び（古い順。同じ時刻は id の昇順）に並べ、同じ id は後から来たもので置き換える。 */
export function mergeMessages(current: readonly DirectMessage[], incoming: readonly DirectMessage[]): DirectMessage[] {
    const byId = new Map([...current, ...incoming].map((m) => [m.id, m]));
    return [...byId.values()].sort((a, b) => {
        const diff = Date.parse(a.published) - Date.parse(b.published);
        return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** messageId のリアクションを置き換える（その 1 通が無ければそのまま）。 */
export const withMessageReactions = (
    messages: readonly DirectMessage[],
    messageId: string,
    reactions: readonly MessageReaction[],
): DirectMessage[] => messages.map((m) => (m.id === messageId ? { ...m, reactions: [...reactions] } : m));

/** 未読の会話の数（タブの件数）。 */
export const unreadConversationCount = (conversations: readonly ConversationSummary[]): number =>
    conversations.filter((c) => c.unreadCount > 0).length;
