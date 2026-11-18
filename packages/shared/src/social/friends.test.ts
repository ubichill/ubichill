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

    /** 相手ごとに friendshipOf で全行を見ていた元の実装（結果が変わらないことの基準）。 */
    const legacyFriendGroupsOf = (edges: readonly FriendEdge[], me: string) => {
        const others = [...new Set(edges.flatMap((e) => [e.userId, e.friendId]).filter((id) => id !== me))];
        const byKind = (kind: string) => others.filter((id) => friendshipOf(edges, me, id) === kind);
        return { friends: byKind('friends'), incoming: byKind('incoming'), outgoing: byKind('outgoing') };
    };

    /** 種から決まる乱数（落ちたときに同じ並びで再現できるように）。 */
    const random = (seed: number) => {
        const state = { s: seed >>> 0 || 1 };
        return () => {
            state.s ^= state.s << 13;
            state.s ^= state.s >>> 17;
            state.s ^= state.s << 5;
            return (state.s >>> 0) / 0x1_0000_0000;
        };
    };

    /** 自分の行・自分を含まない行・自分どうしの行・重複・両向き・承認済みと申請中が混ざった行。 */
    const randomEdges = (seed: number, count: number, people: number): FriendEdge[] => {
        const next = random(seed);
        const person = () => (next() < 0.4 ? 'me' : `u${Math.floor(next() * people)}`);
        return Array.from({ length: count }, () => edge(person(), person(), next() < 0.5 ? 'accepted' : 'pending'));
    };

    it('ランダムな行で、元の実装と同じ結果（並び順も）', () => {
        for (const seed of Array.from({ length: 300 }, (_, i) => i + 1)) {
            const edges = randomEdges(seed, 1 + (seed % 40), 1 + (seed % 12));
            expect(friendGroupsOf(edges, 'me'), `seed ${seed}`).toEqual(legacyFriendGroupsOf(edges, 'me'));
        }
    });

    it('空・自分どうしの行だけ・自分を含まない行だけなら、どれも空', () => {
        const empty = { friends: [], incoming: [], outgoing: [] };
        expect(friendGroupsOf([], 'me')).toEqual(empty);
        expect(friendGroupsOf([edge('me', 'me', 'accepted')], 'me')).toEqual(empty);
        expect(friendGroupsOf([edge('a', 'b', 'accepted'), edge('b', 'a')], 'me')).toEqual(empty);
    });

    it('相手の並びは、行に最初に出てきた順（自分を含まない行での登場も数える）', () => {
        const edges = [edge('x', 'y'), edge('me', 'y', 'accepted'), edge('me', 'x', 'accepted')];
        expect(friendGroupsOf(edges, 'me').friends).toEqual(['x', 'y']);
    });

    it('2 万行でも行の数に比例する時間で終わる（相手ごとに全行を見ない。元の実装は約 30 秒）', () => {
        const edges = Array.from({ length: 20_000 }, (_, i) =>
            i % 2 === 0 ? edge('me', `u${i}`, 'accepted') : edge(`u${i}`, 'me'),
        );
        const started = Date.now();
        const groups = friendGroupsOf(edges, 'me');
        expect(Date.now() - started).toBeLessThan(1000);
        expect(groups.friends).toHaveLength(10_000);
        expect(groups.incoming).toHaveLength(10_000);
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
