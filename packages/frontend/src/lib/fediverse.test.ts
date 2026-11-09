import type { FediverseFollower, FediverseOverview } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { withFollowerAnswered, withManualApprovalOff } from './fediverse';

const person = (n: number, state: FediverseFollower['state']): FediverseFollower => ({
    actorId: `https://misskey.example/users/${n}`,
    account: `u${n}@misskey.example`,
    name: `u${n}`,
    icon: null,
    url: null,
    state,
    since: '2026-11-09T00:00:00.000Z',
});

const overview = (): FediverseOverview => ({
    enabled: true,
    account: 'alice@ubichill.example',
    settings: { manuallyApprovesFollowers: true, discoverable: true },
    pending: [person(1, 'pending'), person(2, 'pending')],
    followers: [person(3, 'accepted')],
    // 一覧は上限までなので、数は一覧より多いことがある
    followerCount: 250,
});

describe('フォロワーの操作を手元の一覧に反映する', () => {
    it('承認すると承認待ちからフォロワーの先頭へ移り、数が増える', () => {
        const next = withFollowerAnswered(overview(), person(2, 'pending').actorId, 'approve');
        expect(next.pending.map((f) => f.account)).toEqual(['u1@misskey.example']);
        expect(next.followers.map((f) => [f.account, f.state])).toEqual([
            ['u2@misskey.example', 'accepted'],
            ['u3@misskey.example', 'accepted'],
        ]);
        expect(next.followerCount).toBe(251);
    });

    it('承認待ちでない人を承認しても変わらない（ほかの端末で片付いた）', () => {
        const before = overview();
        expect(withFollowerAnswered(before, person(3, 'accepted').actorId, 'approve')).toBe(before);
    });

    it('断ると承認待ちから外れ、数は変わらない。フォロワーを外すと数が減る', () => {
        const declined = withFollowerAnswered(overview(), person(1, 'pending').actorId, 'reject');
        expect(declined.pending).toHaveLength(1);
        expect(declined.followerCount).toBe(250);
        const removed = withFollowerAnswered(overview(), person(3, 'accepted').actorId, 'reject');
        expect(removed.followers).toEqual([]);
        expect(removed.followerCount).toBe(249);
    });

    it('承認制をやめると、承認待ちはまとめてフォロワーになる', () => {
        const next = withManualApprovalOff(overview());
        expect(next.settings.manuallyApprovesFollowers).toBe(false);
        expect(next.pending).toEqual([]);
        expect(next.followers.map((f) => f.state)).toEqual(['accepted', 'accepted', 'accepted']);
        expect(next.followerCount).toBe(252);
    });
});
