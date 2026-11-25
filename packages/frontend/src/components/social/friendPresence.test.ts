import type { Instance, UserSummary } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    arrangeFriendPresence,
    friendDirectory,
    friendLocationOf,
    lastKnownOf,
    onlineFriends,
    placeFriendCards,
    requestTargetOf,
    selfLocationOf,
    whereLabel,
} from './friendPresence';

const user = (id: string, name = id): UserSummary => ({ id, name, handle: id, image: null, bio: null });
const room = (id: string, name: string, currentUsers = 1): Instance =>
    ({ id, world: { id: name, displayName: name }, stats: { currentUsers, maxUsers: 16 } }) as Instance;

const data = {
    locations: [
        { instance: room('r1', 'カフェ', 3), friends: [user('a', 'あきら')] },
        { instance: room('r2', 'ゲーム', 8), friends: [user('b', 'ぶん'), user('c', 'ちか')] },
        { instance: room('r3', '図書館', 9), friends: [user('d', 'でん')] },
        { instance: room('mine', 'ホーム', 2), friends: [user('e', 'えま')] },
    ],
    private: [user('f', 'ふみ')],
    elsewhere: [user('h', 'はる'), user('g', 'ぎん')],
};

describe('arrangeFriendPresence', () => {
    it('自分のインスタンスは一番上に分け、ほかのインスタンスの一覧に重ねない', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム'));
        expect(p.here?.friends.map((f) => f.id)).toEqual(['e']);
        expect(p.places.map((x) => x.instance.id)).not.toContain('mine');
    });

    it('ほかのインスタンスはフレンドの多い順、同じなら人の多い順', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム'));
        expect(p.places.map((x) => x.instance.id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('自分のインスタンスにフレンドがいなくても、自分のインスタンスは出す（公開範囲に関係なく）', () => {
        const p = arrangeFriendPresence({ ...data, locations: [] }, room('mine', 'ホーム'));
        expect(p.here).toEqual({ instance: room('mine', 'ホーム'), friends: [] });
    });

    it('サーバーが返した自分のインスタンスの情報（人数）を、手元の古い情報より優先する', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム', 1));
        expect(p.here?.instance.stats.currentUsers).toBe(2);
    });

    it('オンラインはインスタンスにいる人と見えないインスタンスの人。オフラインは数えない', () => {
        expect(arrangeFriendPresence(data, room('mine', 'ホーム')).onlineCount).toBe(6);
        expect(arrangeFriendPresence(data, null).onlineCount).toBe(6);
    });

    it('見えないインスタンス・オフラインは名前順', () => {
        const p = arrangeFriendPresence(data, null);
        expect(p.offline.map((f) => f.id)).toEqual(['g', 'h']);
        expect(p.hidden.map((f) => f.id)).toEqual(['f']);
    });
});

describe('確かめられないフレンド', () => {
    const NOW = Date.parse('2026-11-08T12:00:00Z');
    const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

    it('オフラインにも、オンラインの数にも混ぜない（いないとは言わない）', () => {
        const p = arrangeFriendPresence({ ...data, unreachable: [{ user: user('z', 'ぜん') }] }, null);
        expect(p.unreachable.map((f) => f.user.id)).toEqual(['z']);
        expect(p.offline.map((f) => f.id)).not.toContain('z');
        expect(p.onlineCount).toBe(6);
    });

    it('古い backend（unreachable を返さない）でも並べられる', () => {
        expect(arrangeFriendPresence(data, null).unreachable).toEqual([]);
    });

    it('最後に確かめた場所と時刻を添える。インスタンスの名前が無ければ「インスタンス」、確かめたことが無ければ何も添えない', () => {
        const at = (status: 'in_room' | 'private' | 'offline', place?: string) => ({
            user: user('z'),
            lastKnown: { at: ago(5), status, ...(place ? { place } : {}) },
        });
        expect(lastKnownOf(at('in_room', '森'), NOW)).toBe('5 分前は森');
        expect(lastKnownOf(at('in_room'), NOW)).toBe('5 分前はインスタンス');
        expect(lastKnownOf(at('private'), NOW)).toBe('5 分前はプライベートインスタンス');
        expect(lastKnownOf(at('offline'), NOW)).toBe('5 分前はオフライン');
        expect(lastKnownOf({ user: user('z') }, NOW)).toBeUndefined();
    });
});

describe('onlineFriends', () => {
    it('同じインスタンス → ほかのインスタンス → 見えないインスタンスの順に 1 列にする（インスタンスの中は名前順）', () => {
        const list = onlineFriends(arrangeFriendPresence(data, room('mine', 'ホーム')));
        expect(list.map((x) => `${x.user.id}:${x.where.kind}`)).toEqual([
            'e:here',
            'c:room',
            'b:room',
            'd:room',
            'a:room',
            'f:hidden',
        ]);
    });
});

describe('friendDirectory（すべてのフレンド）', () => {
    const NOW = Date.parse('2026-11-08T12:00:00Z');
    const full = {
        ...data,
        elsewhere: [{ ...user('h', 'はる'), status: '旅行中' }, user('g', 'ぎん')],
        unreachable: [
            {
                user: user('z', 'ぜん'),
                lastKnown: { at: new Date(NOW - 5 * 60_000).toISOString(), status: 'online' as const },
            },
            { user: user('y', 'よう') },
        ],
    };

    it('オンラインはインスタンスをまたいで名前順にし、いる場所を添える（同じインスタンス・見えないインスタンスも）', () => {
        const dir = friendDirectory(arrangeFriendPresence(full, room('mine', 'ホーム')), NOW);
        expect(dir.online.map((c) => `${c.user.name}:${c.detail}`)).toEqual([
            'あきら:カフェ',
            'えま:ここにいます',
            'ちか:ゲーム',
            'でん:図書館',
            'ふみ:プライベート',
            'ぶん:ゲーム',
        ]);
        expect(dir.online.every((c) => c.online)).toBe(true);
    });

    it('オフラインはひとことを添え、確かめられない人は最後に確かめた様子（無ければ何も添えない）。どちらも点は付けない', () => {
        const dir = friendDirectory(arrangeFriendPresence(full, null), NOW);
        expect(dir.offline.map((c) => [c.user.id, c.detail])).toEqual([
            ['g', null],
            ['h', '旅行中'],
        ]);
        expect(dir.unreachable.map((c) => [c.user.id, c.detail])).toEqual([
            ['z', '5 分前はオンライン'],
            ['y', null],
        ]);
        expect([...dir.offline, ...dir.unreachable].some((c) => c.online)).toBe(false);
    });

    it('総数はだれも落とさず、だれも重ねない', () => {
        const dir = friendDirectory(arrangeFriendPresence(full, room('mine', 'ホーム')), NOW);
        const ids = [...dir.online, ...dir.unreachable, ...dir.offline].map((c) => c.user.id);
        expect(dir.total).toBe(10);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('フレンドがいなければ空で、総数は 0', () => {
        const dir = friendDirectory(arrangeFriendPresence({ locations: [], private: [], elsewhere: [] }, null), NOW);
        expect(dir).toEqual({ online: [], unreachable: [], offline: [], total: 0 });
    });
});

describe('placeFriendCards', () => {
    it('インスタンスのカードは場所でなくひとことを添える（書いていなければ null）', () => {
        expect(placeFriendCards([{ ...user('a'), status: 'ねむい' }, user('b')])).toEqual([
            { user: { ...user('a'), status: 'ねむい' }, detail: 'ねむい', online: true },
            { user: user('b'), detail: null, online: true },
        ]);
    });
});

describe('whereLabel', () => {
    it('同じインスタンス・ほかのインスタンス（ワールド名）・見えないインスタンスを一言で', () => {
        expect(whereLabel({ kind: 'here' })).toBe('ここにいます');
        expect(whereLabel({ kind: 'room', instance: room('r', '森') })).toBe('森');
        expect(whereLabel({ kind: 'hidden' })).toBe('プライベート');
    });
});

describe('friendLocationOf（プロフィールの現在地）', () => {
    const NOW = Date.parse('2026-11-08T12:00:00Z');
    const locked = { ...room('lk', '秘密基地'), canJoin: false } as Instance;
    const withRooms = {
        ...data,
        locations: [...data.locations, { instance: locked, friends: [user('k', 'かぎ')] }],
        unreachable: [{ user: user('z', 'ぜん') }],
    };

    it('入れるインスタンスはインスタンスとそこにいるフレンド（名前順）。自分と同じインスタンスなら here', () => {
        const at = friendLocationOf(withRooms, 'b', 'mine', NOW);
        expect(at).toMatchObject({ kind: 'room', here: false, instance: { id: 'r2' } });
        expect(at.kind === 'room' && at.friends.map((f) => f.id)).toEqual(['c', 'b']);
        expect(friendLocationOf(withRooms, 'e', 'mine', NOW)).toMatchObject({ kind: 'room', here: true });
    });

    it('招待が要るインスタンスは、見えていてもどこかを出さずプライベートにする。ただし自分もいるならインスタンスを出す', () => {
        expect(friendLocationOf(withRooms, 'k', 'mine', NOW)).toEqual({ kind: 'private' });
        expect(friendLocationOf(withRooms, 'k', 'lk', NOW)).toMatchObject({ kind: 'room', here: true });
    });

    it('見えないインスタンスはプライベート、インスタンスにいなければオフライン、確かめられなければその旨（オフラインとは言わない）', () => {
        expect(friendLocationOf(withRooms, 'f', undefined, NOW)).toEqual({ kind: 'private' });
        expect(friendLocationOf(withRooms, 'g', undefined, NOW)).toEqual({ kind: 'offline' });
        expect(friendLocationOf(withRooms, 'z', undefined, NOW)).toEqual({ kind: 'unreachable', lastKnown: undefined });
    });

    it('一覧に無い人（フレンドでない・なったばかり）は unknown（オフラインと決めつけない）', () => {
        expect(friendLocationOf(withRooms, 'nobody', undefined, NOW)).toEqual({ kind: 'unknown' });
    });
});

describe('selfLocationOf（自分のプロフィールの現在地）', () => {
    it('今いるインスタンスを、フレンドの一覧に無くても出す（招待が要るインスタンスでも隠さない）', () => {
        const locked = { ...room('lk', '秘密基地'), canJoin: false } as Instance;
        expect(selfLocationOf(data, locked)).toEqual({ kind: 'room', instance: locked, friends: [], here: true });
        expect(selfLocationOf(null, locked)).toMatchObject({ kind: 'room', here: true });
    });

    it('一覧にあればそちらのインスタンス（人数が新しい）とそこにいるフレンドを出す', () => {
        const stale = room('r2', 'ゲーム', 1);
        const at = selfLocationOf(data, stale);
        expect(at.kind === 'room' && at.instance.stats.currentUsers).toBe(8);
        expect(at.kind === 'room' && at.friends.map((f) => f.id)).toEqual(['c', 'b']);
    });

    it('インスタンスの外なら away（オフラインとは言わない）', () => {
        expect(selfLocationOf(data, null)).toEqual({ kind: 'away' });
    });
});

describe('requestTargetOf', () => {
    it('作成者がフレンドなら作成者に頼む（どの公開範囲でも招待できる）。いなければ最初のフレンド', () => {
        const instance = { ...room('r', 'カフェ'), leaderId: 'b' } as Instance;
        expect(requestTargetOf({ instance, friends: [user('a'), user('b')] })?.id).toBe('b');
        expect(requestTargetOf({ instance: { ...instance, leaderId: 'x' }, friends: [user('a'), user('b')] })?.id).toBe(
            'a',
        );
        expect(requestTargetOf({ instance, friends: [] })).toBeUndefined();
    });
});
