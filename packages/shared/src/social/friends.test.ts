import { describe, expect, it } from 'vitest';
import { type FriendEdge, friendGroupsOf, friendshipOf, groupFriendLocations } from './friends';

const edge = (userId: string, friendId: string, status: FriendEdge['status'] = 'pending'): FriendEdge => ({
    userId,
    friendId,
    status,
});

describe('friendshipOf', () => {
    it('申請の向きは問わず、承認済みならフレンド', () => {
        expect(friendshipOf([edge('a', 'b', 'accepted')], 'b', 'a')).toBe('friends');
        expect(friendshipOf([edge('a', 'b', 'accepted')], 'a', 'b')).toBe('friends');
    });

    it('申請中は向きで出す（自分の申請 / 自分への申請）', () => {
        expect(friendshipOf([edge('a', 'b')], 'a', 'b')).toBe('outgoing');
        expect(friendshipOf([edge('a', 'b')], 'b', 'a')).toBe('incoming');
    });

    it('両方向に申請があり片方が承認済みならフレンド。無関係の行は見ない', () => {
        expect(friendshipOf([edge('a', 'b'), edge('b', 'a', 'accepted')], 'a', 'b')).toBe('friends');
        expect(friendshipOf([edge('a', 'c', 'accepted')], 'a', 'b')).toBe('none');
        expect(friendshipOf([], 'a', 'a')).toBe('self');
    });
});

describe('friendGroupsOf', () => {
    it('フレンド・自分への申請・自分の申請に分ける', () => {
        const edges = [edge('me', 'f1', 'accepted'), edge('f2', 'me', 'accepted'), edge('in', 'me'), edge('me', 'out')];
        expect(friendGroupsOf(edges, 'me')).toEqual({ friends: ['f1', 'f2'], incoming: ['in'], outgoing: ['out'] });
    });
});

describe('groupFriendLocations', () => {
    const instances = {
        i1: { id: 'i1', open: true },
        i2: { id: 'i2', open: true },
        hidden: { id: 'hidden', open: false },
    };
    const where: Record<string, keyof typeof instances | undefined> = {
        a: 'i1',
        b: 'i2',
        c: 'i2',
        d: 'hidden',
        e: undefined,
    };
    const result = groupFriendLocations(
        ['a', 'b', 'c', 'd', 'e'],
        (id) => (where[id] ? instances[where[id] as keyof typeof instances] : undefined),
        (i) => i.open,
    );

    it('インスタンスごとにまとめ、フレンドの多い順に並べる', () => {
        expect(result.locations.map((l) => [l.instance.id, l.friendIds])).toEqual([
            ['i2', ['b', 'c']],
            ['i1', ['a']],
        ]);
    });

    it('見えないインスタンスにいるフレンドは、どこかを出さずに非公開の場所にまとめる', () => {
        expect(result.privateFriendIds).toEqual(['d']);
        expect(result.locations.some((l) => l.instance.id === 'hidden')).toBe(false);
    });

    it('インスタンスにいないフレンドは別にする', () => {
        expect(result.elsewhereIds).toEqual(['e']);
    });
});
