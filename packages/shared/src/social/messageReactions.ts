/**
 * メッセージへのリアクション（Unicode 絵文字 1 つ）。付けられるかは messageRefusal と同じ規則（いまフレンドの相手との会話だけ）。
 * 1 人が 1 通に付けられるのは 1 つ（Misskey と同じ）。付け直すと置き換わる。
 */
import { z } from 'zod';

export const REACTION_LIMITS = {
    /** 1 人が 1 通に付けられる種類の数 */
    PER_USER: 1,
    /**
     * 受け付ける長さ（UTF-16 の単位）。RGI のいちばん長い並び（肌色つきの ZWJ の組）でも 15 前後なので、
     * 正規表現にかける前に長い入力を落とすための余裕のある上限。
     */
    EMOJI_MAX_UNITS: 32,
    /** 1 分に付け外しできる回数（1 人あたり） */
    PER_MINUTE: 60,
} as const;

// 'v' フラグの \p{RGI_Emoji} は、ZWJ の組・肌色・国旗・キーキャップ・異体字セレクタ付きの並びを 1 つの絵文字として扱う。
// 文字としての既定が「文字」のもの（❤ など）は U+FE0F が付いた形だけが RGI なので、同じ絵文字が 2 通りに分かれない
const SINGLE_RGI_EMOJI = /^\p{RGI_Emoji}$/v;
// 肌色・髪型の部品は単独でも RGI だが、組み合わせる部品で絵文字として選ぶものではない
const LONE_COMPONENT = /^\p{Emoji_Component}$/u;

/** Unicode の絵文字（RGI）がちょうど 1 つか。組み合わせの部品だけのものは断る。 */
export const isSingleEmoji = (value: string): boolean =>
    value.length > 0 &&
    value.length <= REACTION_LIMITS.EMOJI_MAX_UNITS &&
    SINGLE_RGI_EMOJI.test(value) &&
    !LONE_COMPONENT.test(value);

export const ReactionEmojiSchema = z.string().refine(isSingleEmoji, '絵文字を 1 つ選んでください');

/** `PUT /api/v1/messages/:userId/:messageId/reaction` */
export const ReactRequestSchema = z.object({ emoji: ReactionEmojiSchema }).strict();
export type ReactRequest = z.infer<typeof ReactRequestSchema>;

/** 1 人が付けた 1 つ（会話は 2 人だけなので、誰が付けたかもそのまま見せる）。付けた順に並ぶ。 */
export interface MessageReaction {
    userId: string;
    emoji: string;
}

/** `PUT`・`DELETE` の応答と SSE の reaction（付け外しのあとのその 1 通のリアクションの全部） */
export interface MessageReactionsResponse {
    messageId: string;
    reactions: MessageReaction[];
}

/** 画面に出す 1 つ（絵文字ごと）。 */
export interface ReactionTally {
    emoji: string;
    count: number;
    /** 自分が付けたか */
    mine: boolean;
}

/** 絵文字ごとに数える（最初に付けられた順）。 */
export function tallyReactions(reactions: readonly MessageReaction[], selfId: string | undefined): ReactionTally[] {
    const order = [...new Set(reactions.map((r) => r.emoji))];
    return order.map((emoji) => {
        const by = reactions.filter((r) => r.emoji === emoji);
        return { emoji, count: by.length, mine: by.some((r) => r.userId === selfId) };
    });
}

/** userId のリアクションを emoji にする（null なら外す）。前に付けていたものは置き換え、末尾に回す。 */
export const withReaction = (
    reactions: readonly MessageReaction[],
    userId: string,
    emoji: string | null,
): MessageReaction[] => [...reactions.filter((r) => r.userId !== userId), ...(emoji ? [{ userId, emoji }] : [])];

/** 絵文字を押したときの次の値: 自分が付けたものなら外し、そうでなければそれに付け直す。 */
export const toggledReaction = (reactions: readonly MessageReaction[], userId: string, emoji: string): string | null =>
    reactions.some((r) => r.userId === userId && r.emoji === emoji) ? null : emoji;
