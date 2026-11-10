import { describe, expect, it } from 'vitest';
import { groupFriendLocations } from './friends';
import { limitPresence, type PresenceVisibility } from './presence';

describe('limitPresence（本人の見せ方で狭める）', () => {
    it('いる場所まで: 部屋の規則で決まった状態のまま', () => {
        for (const status of ['offline', 'online', 'private', 'in_room'] as const) {
            expect(limitPresence(status, 'location')).toBe(status);
        }
    });

    it('オンラインだけ: 部屋にいても場所は伏せる（private）。いなければオフラインのまま', () => {
        expect(limitPresence('in_room', 'online')).toBe('private');
        expect(limitPresence('private', 'online')).toBe('private');
        expect(limitPresence('offline', 'online')).toBe('offline');
    });

    it('見せない: いつでもオフライン', () => {
        for (const status of ['offline', 'online', 'private', 'in_room'] as const) {
            expect(limitPresence(status, 'hidden')).toBe('offline');
        }
    });
});

describe('フレンドの現在地の振り分けと見せ方', () => {
    it('同じ見える部屋にいても、場所を見せない人だけ「部屋にいる（どこかは伏せる）」に回す', () => {
        const visibility: Record<string, PresenceVisibility> = { a: 'location', b: 'online' };
        const room = { id: 'r1' };
        const grouped = groupFriendLocations(
            ['a', 'b'],
            () => room,
            (_room, friendId) => visibility[friendId] === 'location',
        );
        expect(grouped.locations).toEqual([{ instance: room, friendIds: ['a'] }]);
        expect(grouped.privateFriendIds).toEqual(['b']);
        expect(grouped.elsewhereIds).toEqual([]);
    });
});
