import type { Instance, UserSummary } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { arrangeFriendPresence, onlineFriends, requestTargetOf } from './friendPresence';

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
    it('自分の部屋は一番上に分け、ほかの部屋の一覧に重ねない', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム'));
        expect(p.here?.friends.map((f) => f.id)).toEqual(['e']);
        expect(p.places.map((x) => x.instance.id)).not.toContain('mine');
    });

    it('ほかの部屋はフレンドの多い順、同じなら人の多い順', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム'));
        expect(p.places.map((x) => x.instance.id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('自分の部屋にフレンドがいなくても、自分の部屋は出す（公開範囲に関係なく）', () => {
        const p = arrangeFriendPresence({ ...data, locations: [] }, room('mine', 'ホーム'));
        expect(p.here).toEqual({ instance: room('mine', 'ホーム'), friends: [] });
    });

    it('サーバーが返した自分の部屋の情報（人数）を、手元の古い情報より優先する', () => {
        const p = arrangeFriendPresence(data, room('mine', 'ホーム', 1));
        expect(p.here?.instance.stats.currentUsers).toBe(2);
    });

    it('オンラインは部屋にいる人と見えない部屋の人。オフラインは数えない', () => {
        expect(arrangeFriendPresence(data, room('mine', 'ホーム')).onlineCount).toBe(6);
        expect(arrangeFriendPresence(data, null).onlineCount).toBe(6);
    });

    it('見えない部屋・オフラインは名前順', () => {
        const p = arrangeFriendPresence(data, null);
        expect(p.offline.map((f) => f.id)).toEqual(['g', 'h']);
        expect(p.hidden.map((f) => f.id)).toEqual(['f']);
    });
});

describe('onlineFriends', () => {
    it('同じ部屋 → ほかの部屋 → 見えない部屋の順に 1 列にする（部屋の中は名前順）', () => {
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
