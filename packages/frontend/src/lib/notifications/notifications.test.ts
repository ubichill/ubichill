import type { AppNotification } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    groupNotifications,
    isExpired,
    NOTIFICATION_TABS,
    notificationText,
    relativeTime,
    serverNoticeMessage,
    toastActionOf,
    unreadBadge,
} from './notifications';

const actor = { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null } as const;
const base = { actor, published: '2026-10-01T00:00:00.000Z', read: false };
const items: AppNotification[] = [
    { ...base, id: '1', type: 'Like', object: { type: 'World', id: 'https://x.example/w.yaml', name: '森' } },
    { ...base, id: '2', type: 'Follow', object: { type: 'Person', id: 'bob' } },
    { ...base, id: '3', type: 'Accept', object: { type: 'Follow', actor: 'bob', object: 'alice' } },
    { ...base, id: '4', type: 'Announce', object: { type: 'Note', id: '4', summary: 'メンテ', content: '本文' } },
    {
        ...base,
        id: '5',
        type: 'Invite',
        object: { type: 'Instance', id: 'room', name: 'カフェ', image: null },
        content: null,
        endTime: '2026-10-02T00:00:00.000Z',
    },
    { ...base, id: '6', type: 'Join', object: { type: 'Person', id: 'bob' }, endTime: '2026-10-01T01:00:00.000Z' },
];

describe('groupNotifications', () => {
    it('招待・リクエストは招待、申請・承認はフレンド、お気に入り・お知らせはその他。並びは保つ', () => {
        const groups = groupNotifications(items);
        expect(groups['friend-request'].map((n) => n.id)).toEqual(['2', '3']);
        expect(groups.other.map((n) => n.id)).toEqual(['1', '4']);
        expect(groups.invite.map((n) => n.id)).toEqual(['5', '6']);
        expect(NOTIFICATION_TABS.map((t) => t.kind)).toEqual(['message', 'invite', 'friend-request', 'other']);
    });
});

describe('notificationText', () => {
    it('種類ごとの文面', () => {
        expect(items.map(notificationText)).toEqual([
            'Alice さんがワールド「森」をお気に入りにしました',
            'Alice さんからフレンドリクエストが届きました',
            'Alice さんがフレンドリクエストを承認しました',
            'お知らせ: メンテ',
            'Alice さんが「カフェ」に招待しています',
            'Alice さんが招待をリクエストしています',
        ]);
    });
});

describe('isExpired', () => {
    it('招待・リクエストは期限の時刻で切れる。ほかの種類は切れない', () => {
        const invite = items[4] as AppNotification;
        expect(isExpired(invite, Date.parse('2026-10-01T23:59:59.999Z'))).toBe(false);
        expect(isExpired(invite, Date.parse('2026-10-02T00:00:00.000Z'))).toBe(true);
        expect(isExpired(items[1] as AppNotification, Date.parse('2099-01-01T00:00:00.000Z'))).toBe(false);
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

describe('toastActionOf', () => {
    const calls: string[] = [];
    const run = {
        enter: (to: string, state: { worldData: { displayName: string } }) =>
            calls.push(`enter ${to} ${state.worldData.displayName}`),
        acceptRequest: (userId: string) => calls.push(`accept ${userId}`),
    };

    it('招待は「入る」でその部屋へ（ID は URL 用にする）、リクエストは「招待する」で答える', () => {
        const invite = {
            ...(items[4] as AppNotification),
            object: { type: 'Instance', id: 'a/b', name: 'カフェ', image: null },
        } as AppNotification;
        toastActionOf(invite, run)?.run();
        toastActionOf(items[5] as AppNotification, run)?.run();
        expect(toastActionOf(invite, run)?.label).toBe('入る');
        expect(calls).toEqual(['enter /instance/a%2Fb カフェ', 'accept alice']);
    });

    it('ほかの種類には操作を付けない', () => {
        expect(toastActionOf(items[0] as AppNotification, run)).toBeUndefined();
    });
});
