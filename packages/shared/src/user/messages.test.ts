import { describe, expect, it } from 'vitest';
import { NOTIFICATION_LIMITS, NotificationSchema } from '../notification/activity';
import {
    type DirectMessage,
    MESSAGE_LIMITS,
    MessageContentSchema,
    mergeMessages,
    messageLength,
    messageRefusal,
    SendMessageRequestSchema,
    unreadConversationCount,
    withMessageReactions,
} from './messages';

describe('messageRefusal', () => {
    it('フレンドには送れる', () => {
        expect(messageRefusal('alice', 'bob', { friends: true })).toBeNull();
    });

    it('フレンドでない（申請中・解除した）なら送れない', () => {
        expect(messageRefusal('alice', 'bob', { friends: false })).toBe('not-friend');
    });

    it('自分にはフレンドかどうかに関わらず送れない（自分を自分のフレンドと誤って渡しても）', () => {
        expect(messageRefusal('alice', 'alice', { friends: true })).toBe('self');
    });

    it('ほかのサーバーの人には、フレンドでもまだ送れない（http の開発用の actor も）', () => {
        expect(messageRefusal('alice', 'https://b.example/ap/users/bob', { friends: true })).toBe('remote');
        expect(messageRefusal('alice', 'http://localhost:3001/ap/users/bob', { friends: true })).toBe('remote');
        expect(messageRefusal('https://b.example/ap/users/bob', 'alice', { friends: true })).toBe('remote');
    });

    it('理由は「自分」が一番先（自分の URL を宛先にしても remote ではなく self）', () => {
        const me = 'https://a.example/ap/users/me';
        expect(messageRefusal(me, me, { friends: false })).toBe('self');
    });
});

describe('MessageContentSchema', () => {
    it('前後の空白を除き、改行は LF にそろえる', () => {
        expect(MessageContentSchema.parse('  やあ\r\nげんき？\r  ')).toBe('やあ\nげんき？');
    });

    it('空・空白だけ・見えない文字だけは断る', () => {
        for (const v of ['', '   ', '\n\n\t', '​​', '﻿', ' ⁠ ']) {
            expect(MessageContentSchema.safeParse(v).success).toBe(false);
        }
    });

    it('絵文字の組み合わせ（ZWJ）は崩さない', () => {
        const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
        expect(MessageContentSchema.parse(family)).toBe(family);
    });

    it('上限はコードポイントで数える（サロゲートペアも 1 文字）', () => {
        expect(MessageContentSchema.safeParse('𠮷'.repeat(MESSAGE_LIMITS.CONTENT_MAX)).success).toBe(true);
        expect(MessageContentSchema.safeParse('𠮷'.repeat(MESSAGE_LIMITS.CONTENT_MAX + 1)).success).toBe(false);
        expect(MessageContentSchema.safeParse('a'.repeat(MESSAGE_LIMITS.CONTENT_MAX + 1)).success).toBe(false);
    });

    it('上限は保存される形で数える（前後の空白・CRLF・向きの制御で入力が長くても、正規化後に収まれば通る）', () => {
        const padded = `${' '.repeat(100)}${'あ'.repeat(MESSAGE_LIMITS.CONTENT_MAX)}‮${'\r\n'.repeat(50)}`;
        expect(messageLength(padded)).toBe(MESSAGE_LIMITS.CONTENT_MAX);
        expect(MessageContentSchema.safeParse(padded).success).toBe(true);
    });

    it('向きを偽る制御（RLO など）は除く', () => {
        expect(MessageContentSchema.parse('a‮gnp.exe‬')).toBe('agnp.exe');
        expect(MessageContentSchema.parse('⁦x⁩')).toBe('x');
    });

    it('改行・タブ以外の制御文字は断る（C1 制御も）', () => {
        expect(MessageContentSchema.safeParse('a\u0000b').success).toBe(false);
        expect(MessageContentSchema.safeParse('a\u0007b').success).toBe(false);
        expect(MessageContentSchema.safeParse('a\u0085b').success).toBe(false);
        expect(MessageContentSchema.safeParse('a\u007Fb').success).toBe(false);
        expect(MessageContentSchema.parse('a\tb')).toBe('a\tb');
    });

    it('リクエストは content だけ（ほかの項目は断る）', () => {
        expect(SendMessageRequestSchema.safeParse({ content: 'x' }).success).toBe(true);
        expect(SendMessageRequestSchema.safeParse({ content: 'x', senderId: 'mallory' }).success).toBe(false);
        expect(SendMessageRequestSchema.safeParse({ content: 1 }).success).toBe(false);
    });
});

describe('上限の決まり', () => {
    it('保存期間は通知と同じ', () => {
        expect(MESSAGE_LIMITS.RETENTION_DAYS).toBe(NOTIFICATION_LIMITS.RETENTION_DAYS);
    });

    it('上限いっぱいのサロゲートペアの本文でも、通知（Create）の形に収まる', () => {
        const content = MessageContentSchema.parse('😀'.repeat(MESSAGE_LIMITS.CONTENT_MAX));
        const parsed = NotificationSchema.safeParse({
            id: 'n1',
            type: 'Create',
            actor: { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null },
            object: { type: 'Note', id: 'm1', content },
            published: '2026-11-10T00:00:00.000Z',
            read: false,
        });
        expect(parsed.success).toBe(true);
    });
});

const msg = (id: string, published: string, content = id): DirectMessage => ({
    id,
    senderId: 'alice',
    content,
    published,
    reactions: [],
});

describe('mergeMessages', () => {
    it('古い順に並べ、同じ時刻は id の昇順', () => {
        const merged = mergeMessages(
            [msg('b', '2026-11-10T00:00:01.000Z'), msg('c', '2026-11-10T00:00:00.000Z')],
            [msg('a', '2026-11-10T00:00:01.000Z')],
        );
        expect(merged.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    });

    it('同じ id は後から来たもので置き換え、重複させない（ページの重なり・送った直後の取り直し）', () => {
        const merged = mergeMessages(
            [msg('a', '2026-11-10T00:00:00.000Z', '古い')],
            [msg('a', '2026-11-10T00:00:00.000Z', '新しい')],
        );
        expect(merged).toEqual([msg('a', '2026-11-10T00:00:00.000Z', '新しい')]);
    });

    it('空どうしは空', () => {
        expect(mergeMessages([], [])).toEqual([]);
    });
});

describe('withMessageReactions', () => {
    it('その 1 通だけを置き換え、ほかと元の配列は変えない', () => {
        const before = [msg('a', '2026-11-10T00:00:00.000Z'), msg('b', '2026-11-10T00:00:01.000Z')];
        const after = withMessageReactions(before, 'b', [{ userId: 'bob', emoji: '👍' }]);
        expect(after[0]).toBe(before[0]);
        expect(after[1]?.reactions).toEqual([{ userId: 'bob', emoji: '👍' }]);
        expect(before[1]?.reactions).toEqual([]);
    });

    it('会話に無い id なら何も変えない（読み込む前の 1 通への SSE）', () => {
        const before = [msg('a', '2026-11-10T00:00:00.000Z')];
        expect(withMessageReactions(before, 'zzz', [{ userId: 'bob', emoji: '👍' }])).toEqual(before);
    });
});

describe('unreadConversationCount', () => {
    it('未読のある会話の数（未読の通数ではない）', () => {
        const user = { id: 'x', name: 'X', handle: 'x', image: null, bio: null };
        const last = msg('m', '2026-11-10T00:00:00.000Z');
        expect(
            unreadConversationCount([
                { user, last, unreadCount: 3 },
                { user, last, unreadCount: 0 },
                { user, last, unreadCount: 1 },
            ]),
        ).toBe(2);
    });
});
