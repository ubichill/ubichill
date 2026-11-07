import { describe, expect, it } from 'vitest';
import type { FriendshipActor } from './friendships';
import { createInbox } from './inbox';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const BOB: FriendshipActor = {
    id: 'https://b.example/ap/users/bob',
    inbox: 'https://b.example/ap/users/bob/inbox',
    domain: 'b.example',
    deletedAt: null,
};
const offer = (id = 'https://b.example/ap/activities/1', actor = BOB.id) => ({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Offer',
    actor,
    target: 'https://a.example/ap/users/alice',
    object: {
        id: 'https://b.example/ap/friendships/1',
        type: 'Relationship',
        subject: actor,
        relationship: 'http://purl.org/vocab/relationship/friendOf',
        object: 'https://a.example/ap/users/alice',
    },
});

function setup(options: { failOffer?: boolean } = {}) {
    const calls: string[] = [];
    const seen = new Set<string>();
    const inbox = createInbox({
        seen: {
            remember: async (key) => {
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            },
            forget: async (key) => void seen.delete(key),
        },
        friendships: {
            onOffer: async (_actor, activity) => {
                if (options.failOffer) throw new Error('DB down');
                calls.push(`offer ${activity.id}`);
            },
            onAccept: async (_actor, activity) => void calls.push(`accept ${activity.object.id}`),
            onReject: async () => void calls.push('reject'),
            onUndo: async (_actor, activity) => void calls.push(`undo ${activity.object.id}`),
            onActorDeleted: async (id) => void calls.push(`deleted ${id}`),
        },
        invites: {
            onInvite: async (_actor, activity) => void calls.push(`invite ${activity.room.id}`),
            onRequestInvite: async (_actor, activity) => void calls.push(`request ${activity.target}`),
        },
        actors: {
            refresh: async (id) => void calls.push(`refresh ${id}`),
            markDeleted: async (id) => void calls.push(`mark ${id}`),
        },
        now: () => NOW,
    });
    return { inbox, calls, seen };
}

describe('受信箱', () => {
    it('申請を振り分け、同じ activity の 2 度目は何もしない', async () => {
        const { inbox, calls } = setup();
        expect(await inbox.receive(BOB, offer())).toBe('accepted');
        expect(await inbox.receive(BOB, offer())).toBe('accepted');
        expect(calls).toEqual(['offer https://b.example/ap/activities/1']);
    });

    it('署名した人と違う actor を名乗る activity は受けない', async () => {
        const { inbox, calls } = setup();
        const carol = 'https://b.example/ap/users/carol';
        expect(await inbox.receive(BOB, offer('https://b.example/ap/activities/2', carol))).toBe('forbidden');
        expect(calls).toEqual([]);
    });

    it('id と actor が別のオリジンの activity は受けない（乗っ取りを防ぐ）', async () => {
        const { inbox, calls } = setup();
        expect(await inbox.receive(BOB, offer('https://evil.example/ap/activities/1'))).toBe('forbidden');
        expect(calls).toEqual([]);
    });

    it('形の壊れた本文は 400、知らない型は受けて捨てる', async () => {
        const { inbox, calls } = setup();
        expect(await inbox.receive(BOB, { hello: 'world' })).toBe('malformed');
        expect(await inbox.receive(BOB, { id: 'https://b.example/ap/activities/9', type: 'Like', actor: BOB.id })).toBe(
            'accepted',
        );
        expect(calls).toEqual([]);
    });

    it('処理に失敗したら覚えた id を忘れ、送り直しを受ける', async () => {
        const failing = setup({ failOffer: true });
        await expect(failing.inbox.receive(BOB, offer())).rejects.toThrow('DB down');
        expect(failing.seen.size).toBe(0);
    });

    it('招待・リクエスト・更新・削除を振り分ける', async () => {
        const { inbox, calls } = setup();
        const base = { '@context': 'https://www.w3.org/ns/activitystreams', actor: BOB.id };
        await inbox.receive(BOB, {
            ...base,
            id: 'https://b.example/ap/activities/i1',
            type: 'Invite',
            target: 'https://a.example/ap/users/alice',
            object: { id: 'https://b.example/ap/instances/r1', type: 'Instance', name: '森' },
            endTime: '2026-11-08T00:00:00Z',
        });
        await inbox.receive(BOB, {
            ...base,
            id: 'https://b.example/ap/activities/r1',
            type: 'RequestInvite',
            object: 'https://a.example/ap/users/alice',
            endTime: '2026-11-07T01:00:00Z',
        });
        await inbox.receive(BOB, {
            ...base,
            id: 'https://b.example/ap/activities/u1',
            type: 'Update',
            object: { id: BOB.id },
        });
        await inbox.receive(BOB, { ...base, id: 'https://b.example/ap/activities/d1', type: 'Delete', object: BOB.id });
        expect(calls).toEqual([
            'invite https://b.example/ap/instances/r1',
            'request https://a.example/ap/users/alice',
            `refresh ${BOB.id}`,
            `mark ${BOB.id}`,
            `deleted ${BOB.id}`,
        ]);
    });

    it('ほかの人を消す Delete は受けない（自分自身の削除だけ）', async () => {
        const { inbox, calls } = setup();
        await inbox.receive(BOB, {
            id: 'https://b.example/ap/activities/d2',
            type: 'Delete',
            actor: BOB.id,
            object: 'https://b.example/ap/users/carol',
        });
        expect(calls).toEqual([]);
    });
});
