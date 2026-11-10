import { type AppNotification, type ConversationPage, type DirectMessage, MESSAGE_LIMITS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    composerKeyAction,
    draftState,
    messagePreview,
    messageSignalOf,
    messageTime,
    shouldToast,
    toastTextOf,
    unreadMessageCount,
    withConversationPage,
    withSentMessage,
} from './messages';
import { groupNotifications } from './notifications';

const person = (id: string) =>
    ({ type: 'Person', id, name: id.toUpperCase(), preferredUsername: id, icon: null }) as const;
const message = (id: string, from: string, read = false, content = 'やあ'): AppNotification => ({
    id,
    type: 'Create',
    actor: person(from),
    object: { type: 'Note', id: `m-${id}`, content },
    published: '2026-11-10T00:00:00.000Z',
    read,
});
const follow: AppNotification = {
    id: 'f1',
    type: 'Follow',
    actor: person('carol'),
    object: { type: 'Person', id: 'me' },
    published: '2026-11-10T00:00:00.000Z',
    read: false,
};

describe('messageSignalOf', () => {
    it('メッセージの通知が作り直されると変わり、ほかの種類の通知では変わらない', () => {
        const before = messageSignalOf([message('n1', 'alice')]);
        expect(messageSignalOf([message('n1', 'alice'), follow])).toBe(before);
        expect(messageSignalOf([message('n2', 'alice')])).not.toBe(before);
    });

    it('相手を渡すと、その人から届いた分だけで決まる', () => {
        const items = [message('n1', 'alice'), message('n2', 'bob')];
        const alice = messageSignalOf(items, 'alice');
        expect(messageSignalOf([message('n1', 'alice'), message('n9', 'bob')], 'alice')).toBe(alice);
        expect(messageSignalOf([message('n3', 'alice'), message('n2', 'bob')], 'alice')).not.toBe(alice);
    });

    it('既読になっただけでは変わらない（読んだら取り直す、を繰り返さない）', () => {
        expect(messageSignalOf([message('n1', 'alice', true)])).toBe(messageSignalOf([message('n1', 'alice')]));
    });

    it('並びが変わっても同じ', () => {
        const a = message('n1', 'alice');
        const b = message('n2', 'bob');
        expect(messageSignalOf([a, b])).toBe(messageSignalOf([b, a]));
    });
});

describe('unreadMessageCount', () => {
    it('未読のメッセージの通知だけを数える', () => {
        expect(unreadMessageCount([message('1', 'a'), message('2', 'b', true), follow])).toBe(1);
    });
});

describe('messagePreview', () => {
    it('改行・連続する空白は 1 つの空白にする', () => {
        expect(messagePreview('  一行目\n\n二行目\t三  ')).toBe('一行目 二行目 三');
    });

    it('長ければ末尾を … にして、上限の文字数に収める（サロゲートペアを割らない）', () => {
        const preview = messagePreview('𠮷'.repeat(10), 5);
        expect(preview).toBe('𠮷𠮷𠮷𠮷…');
        expect(Array.from(preview)).toHaveLength(5);
        expect(messagePreview('abcde', 5)).toBe('abcde');
    });
});

describe('draftState', () => {
    it('空白だけは送れない・上限ちょうどは送れる・超えたら over', () => {
        expect(draftState(' \n ').sendable).toBe(false);
        expect(draftState('あ'.repeat(MESSAGE_LIMITS.CONTENT_MAX))).toEqual({
            length: MESSAGE_LIMITS.CONTENT_MAX,
            over: false,
            sendable: true,
        });
        expect(draftState('あ'.repeat(MESSAGE_LIMITS.CONTENT_MAX + 1))).toMatchObject({ over: true, sendable: false });
    });

    it('数えるのは送られる形（前後の空白は数えない）', () => {
        expect(draftState('  ab  ').length).toBe(2);
    });
});

describe('composerKeyAction', () => {
    const key = (over: Partial<Parameters<typeof composerKeyAction>[0]>) =>
        composerKeyAction({ key: 'Enter', shiftKey: false, isComposing: false, ...over });

    it('Enter で送り、Shift+Enter は改行', () => {
        expect(key({})).toBe('send');
        expect(key({ shiftKey: true })).toBeNull();
    });

    it('変換中の Enter は送らない（isComposing・keyCode 229 のどちらでも）', () => {
        expect(key({ isComposing: true })).toBeNull();
        expect(key({ keyCode: 229 })).toBeNull();
    });

    it('Enter 以外は何もしない', () => {
        expect(key({ key: 'a' })).toBeNull();
    });
});

describe('messageTime', () => {
    it('同じ日なら時刻だけ、日付が違えば日付も（年をまたいでも同じ月日なら日付を出す）', () => {
        const now = new Date(2026, 10, 10, 18, 0);
        expect(messageTime(new Date(2026, 10, 10, 9, 5).toISOString(), now)).toBe('09:05');
        expect(messageTime(new Date(2026, 10, 9, 9, 5).toISOString(), now)).toContain('11/9');
        expect(messageTime(new Date(2025, 10, 10, 9, 5).toISOString(), now)).toContain('11/10');
    });
});

describe('withConversationPage', () => {
    const user = { id: 'bob', name: 'Bob', handle: 'bob', image: null, bio: null };
    const dm = (id: string, sec: number): DirectMessage => ({
        id,
        senderId: 'bob',
        content: id,
        published: new Date(Date.UTC(2026, 10, 10, 0, 0, sec)).toISOString(),
    });
    const page = (messages: DirectMessage[], nextCursor: string | null, refusal: ConversationPage['refusal'] = null) =>
        ({ user, messages, nextCursor, refusal }) satisfies ConversationPage;

    it('初めのページは新しい順で届いても古い順にし、カーソルをそのまま使う', () => {
        const state = withConversationPage(null, page([dm('b', 2), dm('a', 1)], 'c1'), 'latest');
        expect(state.messages.map((m) => m.id)).toEqual(['a', 'b']);
        expect(state.nextCursor).toBe('c1');
    });

    it('前を読むと前に足してカーソルを進める。そのあと最新を取り直しても読んだ位置は戻らない', () => {
        const first = withConversationPage(null, page([dm('c', 3), dm('b', 2)], 'c1'), 'latest');
        const older = withConversationPage(first, page([dm('a', 1)], null), 'older');
        expect(older.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
        expect(older.nextCursor).toBeNull();
        const refreshed = withConversationPage(older, page([dm('d', 4), dm('c', 3)], 'c-again'), 'latest');
        expect(refreshed.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(refreshed.nextCursor).toBeNull();
    });

    it('送れるかは最新の取り直しで新しくする（読んでいる間にフレンドを解除された）。前を読んでも変えない', () => {
        const first = withConversationPage(null, page([dm('b', 2)], 'c1'), 'latest');
        const unfriended = withConversationPage(first, page([dm('b', 2)], 'c1', 'not-friend'), 'latest');
        expect(unfriended.refusal).toBe('not-friend');
        expect(withConversationPage(unfriended, page([dm('a', 1)], null, null), 'older').refusal).toBe('not-friend');
    });

    it('送ったものを足しても、取り直しで先に届いていれば重ならない', () => {
        const state = withConversationPage(null, page([dm('b', 2)], null), 'latest');
        expect(withSentMessage(state, dm('b', 2)).messages).toHaveLength(1);
        expect(withSentMessage(state, dm('c', 3)).messages.map((m) => m.id)).toEqual(['b', 'c']);
    });
});

describe('shouldToast', () => {
    it('開いている会話の相手からのメッセージは出さず、ほかの人・ほかの種類は出す', () => {
        expect(shouldToast(message('1', 'alice'), 'alice')).toBe(false);
        expect(shouldToast(message('1', 'bob'), 'alice')).toBe(true);
        expect(shouldToast(message('1', 'alice'), null)).toBe(true);
        expect(shouldToast({ ...follow, actor: person('alice') }, 'alice')).toBe(true);
    });

    it('既読で届いたものは出さない', () => {
        expect(shouldToast(message('1', 'bob', true), null)).toBe(false);
    });
});

describe('通知の中のメッセージ', () => {
    it('メッセージの種類に分ける', () => {
        expect(groupNotifications([message('1', 'a'), follow]).message.map((n) => n.id)).toEqual(['1']);
    });

    it('トーストは送った人の名前と本文の頭（ほかの種類は一覧と同じ文面）', () => {
        expect(toastTextOf(message('1', 'alice', false, 'こんにちは\nまた'))).toBe('ALICE: こんにちは また');
        expect(toastTextOf(follow)).toBe('CAROL さんからフレンドリクエストが届きました');
    });
});
