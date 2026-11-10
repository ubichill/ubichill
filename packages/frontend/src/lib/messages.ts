/**
 * メッセージの画面の純粋な規則（届いたことの検知・未読の数・入力・時刻の見せ方）。
 * 届いたことは通知の一覧（Create は会話ごとに最新の 1 件）から読み、別の接続を持たない。
 */
import {
    type AppNotification,
    type ConversationPage,
    type DirectMessage,
    MESSAGE_LIMITS,
    MessageContentSchema,
    type MessageReaction,
    type MessageRefusal,
    mergeMessages,
    messageLength,
    type UserSummary,
    withMessageReactions,
} from '@ubichill/shared';
import { notificationText } from './notifications';

/** 開いている会話（メッセージは古い順）。 */
export interface ConversationState {
    user: UserSummary;
    messages: DirectMessage[];
    /** もっと前を読むカーソル（無ければいちばん前まで読んだ） */
    nextCursor: string | null;
    refusal: MessageRefusal | null;
}

/**
 * 取ったページを当てる。latest（最新のページの取り直し）は送れるかを新しくし、前を読むカーソルは最初の 1 回だけ使う
 * （前を読み進めたあとに取り直しても、読んだ位置を巻き戻さない）。older は前を読む位置を進める。
 */
export function withConversationPage(
    state: ConversationState | null,
    page: ConversationPage,
    part: 'latest' | 'older',
): ConversationState {
    return {
        user: page.user,
        messages: mergeMessages(state?.messages ?? [], page.messages),
        nextCursor: part === 'older' || !state ? page.nextCursor : state.nextCursor,
        refusal: part === 'latest' || !state ? page.refusal : state.refusal,
    };
}

/** 送ったメッセージを足す（取り直しで先に届いていても重ならない）。 */
export const withSentMessage = (state: ConversationState, message: DirectMessage): ConversationState => ({
    ...state,
    messages: mergeMessages(state.messages, [message]),
});

/** 1 通のリアクションを置き換える（付け外しの応答・SSE・楽観的な反映で同じもの）。 */
export const withReactions = (
    state: ConversationState,
    messageId: string,
    reactions: readonly MessageReaction[],
): ConversationState => ({ ...state, messages: withMessageReactions(state.messages, messageId, reactions) });

type MessageNotification = Extract<AppNotification, { type: 'Create' }>;

const isMessage = (n: AppNotification): n is MessageNotification => n.type === 'Create';

/**
 * 新しいメッセージが届いたら変わる値（相手を渡せばその人から届いた分だけ）。届くたびに通知を作り直すので id が変わる。
 * 会話の一覧・開いている会話は、これが変わったら取り直す。
 */
export const messageSignalOf = (items: readonly AppNotification[], peerId?: string): string =>
    items
        .filter(isMessage)
        .filter((n) => !peerId || n.actor.id === peerId)
        .map((n) => n.id)
        .sort()
        .join(',');

/** 未読の会話の数（通知は会話ごとに 1 件なので、未読の Create の数）。 */
export const unreadMessageCount = (items: readonly AppNotification[]): number =>
    items.filter((n) => isMessage(n) && !n.read).length;

/** 1 行の抜き出し（空白・改行は 1 つの空白に、長ければ末尾を … にする。文字はコードポイントで数える）。 */
export function messagePreview(content: string, max = 60): string {
    const line = content.replace(/\s+/g, ' ').trim();
    const chars = Array.from(line);
    return chars.length <= max ? line : `${chars.slice(0, max - 1).join('')}…`;
}

/** 入力の状態: 送れるか・文字数・上限を超えたか。 */
export function draftState(draft: string): { length: number; over: boolean; sendable: boolean } {
    const length = messageLength(draft);
    const over = length > MESSAGE_LIMITS.CONTENT_MAX;
    return { length, over, sendable: !over && MessageContentSchema.safeParse(draft).success };
}

/** 入力欄のキー: Enter で送る。Shift+Enter は改行。変換中（IME）の Enter は確定なので送らない。 */
export function composerKeyAction(e: {
    key: string;
    shiftKey: boolean;
    isComposing: boolean;
    keyCode?: number;
}): 'send' | null {
    if (e.key !== 'Enter' || e.shiftKey) return null;
    // Safari は変換の確定の Enter で isComposing が false になることがあるので、keyCode 229 も変換中とみなす
    if (e.isComposing || e.keyCode === 229) return null;
    return 'send';
}

/** トーストの文面。メッセージは本文の頭も見せる（開かずに読めるように）。 */
export const toastTextOf = (n: AppNotification): string =>
    isMessage(n) ? `${n.actor.name}: ${messagePreview(n.object.content)}` : notificationText(n);

/**
 * 届いた通知をトーストに出すか。開いている会話の相手からのメッセージは、画面にそのまま出るので出さない。
 * リアクションは返事を求めるものではないので、ベルの未読だけにして割り込まない。
 */
export const shouldToast = (n: AppNotification, openPeerId: string | null): boolean =>
    !n.read && n.type !== 'EmojiReact' && !(isMessage(n) && n.actor.id === openPeerId);

const timeFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

/** 送った時刻: 今日なら時刻だけ、ほかの日は日付も。 */
export function messageTime(iso: string, now: Date): string {
    const at = new Date(iso);
    const sameDay =
        at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    return (sameDay ? timeFormat : dateTimeFormat).format(at);
}
