import type { AppNotification } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    groupNotifications,
    NOTIFICATION_TABS,
    notificationText,
    relativeTime,
    serverNoticeMessage,
    unreadBadge,
} from './notifications';

const actor = { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null } as const;
const base = { actor, published: '2026-10-01T00:00:00.000Z', read: false };
const items: AppNotification[] = [
    { ...base, id: '1', type: 'Like', object: { type: 'World', id: 'https://x.example/w.yaml', name: '森' } },
    { ...base, id: '2', type: 'Follow', object: { type: 'Person', id: 'bob' } },
    { ...base, id: '3', type: 'Accept', object: { type: 'Follow', actor: 'bob', object: 'alice' } },
    { ...base, id: '4', type: 'Announce', object: { type: 'Note', id: '4', summary: 'メンテ', content: '本文' } },
];

describe('groupNotifications', () => {
    it('申請・承認はフレンド、お気に入り・お知らせはその他。並びは保ち、無い種類も空で持つ', () => {
        const groups = groupNotifications(items);
        expect(groups['friend-request'].map((n) => n.id)).toEqual(['2', '3']);
        expect(groups.other.map((n) => n.id)).toEqual(['1', '4']);
        expect(groups.invite).toEqual([]);
        expect(NOTIFICATION_TABS.map((t) => t.kind)).toEqual(['invite', 'friend-request', 'other']);
    });
});

describe('notificationText', () => {
    it('種類ごとの文面', () => {
        expect(items.map(notificationText)).toEqual([
            'Alice さんがワールド「森」をお気に入りにしました',
            'Alice さんからフレンドリクエストが届きました',
            'Alice さんがフレンドリクエストを承認しました',
            'お知らせ: メンテ',
        ]);
    });
});

describe('unreadBadge', () => {
    it('0 以下は出さず、100 以上は 99+', () => {
        expect(unreadBadge(0)).toBeNull();
        expect(unreadBadge(-1)).toBeNull();
        expect(unreadBadge(7)).toBe('7');
        expect(unreadBadge(99)).toBe('99');
        expect(unreadBadge(100)).toBe('99+');
    });
});

describe('serverNoticeMessage', () => {
    const now = 1_800_000_000_000;
    it('切るまでの時間を秒・分で出す。過ぎていれば「まもなく」', () => {
        expect(serverNoticeMessage({ kind: 'disconnect', at: now + 30_000 }, now)).toBe(
            '約 30 秒後に接続が切れます（自動で繋ぎ直します）',
        );
        expect(serverNoticeMessage({ kind: 'disconnect', at: now + 5 * 60_000 }, now)).toBe(
            '約 5 分後に接続が切れます（自動で繋ぎ直します）',
        );
        expect(serverNoticeMessage({ kind: 'disconnect', at: now - 1000 }, now)).toBe(
            'まもなく接続が切れます（自動で繋ぎ直します）',
        );
    });
});

describe('relativeTime', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    it('秒・分・時間・日で丸める', () => {
        expect(relativeTime('2026-10-04T11:59:30Z', now)).toBe('数秒前');
        expect(relativeTime('2026-10-04T11:57:00Z', now)).toBe('3 分前');
        expect(relativeTime('2026-10-04T10:00:00Z', now)).toBe('2 時間前');
        expect(relativeTime('2026-09-29T12:00:00Z', now)).toBe('5 日前');
    });
    it('未来の時刻（時計のずれ）は数秒前', () => {
        expect(relativeTime('2026-10-04T12:05:00Z', now)).toBe('数秒前');
    });
});
