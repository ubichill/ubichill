import { describe, expect, it } from 'vitest';
import {
    canJoinInstance,
    canSeeInstance,
    type FriendEdge,
    friendGroupsOf,
    friendshipOf,
    groupFriendLocations,
    type InstanceAudience,
} from './friends';

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

const audience = (accessType: InstanceAudience['accessType'], memberIds: string[] = []): InstanceAudience => ({
    accessType,
    leaderId: 'leader',
    memberIds,
});

describe('canSeeInstance / canJoinInstance', () => {
    const none = new Set<string>();
    const friendOfLeader = new Set(['leader']);
    const friendOfMember = new Set(['m1']);

    it('パブリックはログインしていなくても見える。ほかはログインが要る', () => {
        expect(canSeeInstance(audience('public'), null, none)).toBe(true);
        expect(canSeeInstance(audience('friend_plus', ['m1']), null, friendOfMember)).toBe(false);
        expect(canJoinInstance(audience('public'), null, none)).toBe(false);
    });

    it('フレンドのみ: 作成者のフレンドだけ。参加者のフレンドでは見えない', () => {
        expect(canSeeInstance(audience('friend_only', ['m1']), 'v', friendOfLeader)).toBe(true);
        expect(canSeeInstance(audience('friend_only', ['m1']), 'v', friendOfMember)).toBe(false);
    });

    it('フレンド+: 作成者か参加者の誰かのフレンド', () => {
        expect(canSeeInstance(audience('friend_plus', ['m1']), 'v', friendOfMember)).toBe(true);
        expect(canSeeInstance(audience('friend_plus', ['m1']), 'v', none)).toBe(false);
    });

    it('招待のみ: 一覧には出ないが、URL を受け取った人は入れる', () => {
        expect(canSeeInstance(audience('invite_only'), 'v', friendOfLeader)).toBe(false);
        expect(canJoinInstance(audience('invite_only'), 'v', none)).toBe(true);
    });

    it('作成者と参加している人にはいつも見える（フレンドでなくても）', () => {
        expect(canSeeInstance(audience('invite_only'), 'leader', none)).toBe(true);
        expect(canSeeInstance(audience('friend_only', ['v']), 'v', none)).toBe(true);
    });

    it('フレンドのみに入れないのは見えない人と同じ', () => {
        expect(canJoinInstance(audience('friend_only'), 'v', none)).toBe(false);
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
