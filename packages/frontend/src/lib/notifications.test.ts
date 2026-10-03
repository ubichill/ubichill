import { describe, expect, it } from 'vitest';
import { groupNotifications, NOTIFICATION_TABS, notificationsFrom, relativeTime } from './notifications';

const request = (id: string, requestedAt: string) => ({ id, name: id, handle: id, profileImageUrl: null, requestedAt });

describe('notificationsFrom / groupNotifications', () => {
    const items = notificationsFrom({
        incomingFriendRequests: [request('old', '2026-10-01T00:00:00Z'), request('new', '2026-10-03T00:00:00Z')],
    });

    it('フレンドリクエストを新しい順の通知にする', () => {
        expect(items.map((n) => n.id)).toEqual(['friend-request:new', 'friend-request:old']);
    });

    it('種類ごとに分け、無い種類も空で持つ（タブの件数 0 を出せる）', () => {
        const groups = groupNotifications(items);
        expect(groups['friend-request']).toHaveLength(2);
        expect(groups.invite).toEqual([]);
        expect(groups.other).toEqual([]);
    });

    it('通知タブは招待・フレンドリクエスト・その他の順', () => {
        expect(NOTIFICATION_TABS.map((t) => t.kind)).toEqual(['invite', 'friend-request', 'other']);
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
