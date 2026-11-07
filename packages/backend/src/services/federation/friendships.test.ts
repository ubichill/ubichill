import type { RemoteFriendshipRecord } from '@ubichill/db';
import { type DomainPolicy, FEDERATION_LIMITS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createRemoteFriendships, type FriendshipActor, friendshipViewOf } from './friendships';
import { createFederationIdentity } from './identity';

const identity = createFederationIdentity('https://a.example');
const BOB: FriendshipActor = {
    id: 'https://c.example/ap/users/bob',
    inbox: 'https://c.example/ap/users/bob/inbox',
    domain: 'c.example',
    deletedAt: null,
};
const CAROL: FriendshipActor = {
    ...BOB,
    id: 'https://c.example/ap/users/carol',
    inbox: 'https://c.example/ap/users/carol/inbox',
};
const ALICE_URL = identity.actorUrl('alice');

function setup(options: { policy?: DomainPolicy } = {}) {
    const clock = { now: Date.parse('2026-11-07T00:00:00Z') };
    const rows: RemoteFriendshipRecord[] = [];
    const sent: Array<{ to: string; activity: Record<string, unknown> }> = [];
    const notes: string[] = [];
    const seen = new Map<string, number>();
    const key = (r: { userId: string; actorId: string }) => `${r.userId}|${r.actorId}`;
    const find = (userId: string, actorId: string) => rows.find((r) => key(r) === `${userId}|${actorId}`);
    const friendships = createRemoteFriendships({
        identity,
        repo: {
            get: async (userId, actorId) => find(userId, actorId),
            put: async (input, now) => {
                const existing = find(input.userId, input.actorId);
                const row: RemoteFriendshipRecord = {
                    userId: input.userId,
                    actorId: input.actorId,
                    state: input.state,
                    offerId: input.offerId,
                    relationshipId: input.relationshipId,
                    acceptId: input.acceptId ?? null,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                };
                if (existing) rows.splice(rows.indexOf(existing), 1, row);
                else rows.push(row);
                return row;
            },
            remove: async (userId, actorId) => {
                const row = find(userId, actorId);
                if (row) rows.splice(rows.indexOf(row), 1);
                return row;
            },
            removeAllFor: async (actorId) => {
                const hit = rows.filter((r) => r.actorId === actorId);
                for (const r of hit) rows.splice(rows.indexOf(r), 1);
                return hit;
            },
            findByOffer: async (offerId) => rows.filter((r) => r.offerId === offerId),
            findByAccept: async (acceptId) => rows.filter((r) => r.acceptId === acceptId),
            countIncoming: async (userId) => rows.filter((r) => r.userId === userId && r.state === 'incoming').length,
        },
        userExists: async (userId) => userId === 'alice' || userId.startsWith('user'),
        outbox: { send: async (input) => void sent.push({ to: input.to.id, activity: input.activity }) },
        notify: {
            remoteFriendRequested: async (actor, user) => void notes.push(`requested ${actor} → ${user}`),
            remoteFriendAccepted: async (actor, user) => void notes.push(`accepted ${actor} → ${user}`),
            remoteFriendshipConfirmed: async (user, actor) => void notes.push(`confirmed ${user} ← ${actor}`),
            remoteFriendshipRemoved: async (user, actor) => void notes.push(`removed ${user} × ${actor}`),
        },
        seen: {
            remember: async (k, expiresAt, now) => {
                const at = seen.get(k);
                if (at !== undefined && at > now.getTime()) return false;
                seen.set(k, expiresAt.getTime());
                return true;
            },
            has: async (k, now) => (seen.get(k) ?? 0) > now.getTime(),
        },
        policyOf: () => options.policy ?? 'allow',
        now: () => clock.now,
    });
    const tick = (ms: number) => {
        clock.now += ms;
    };
    return { friendships, rows, sent, notes, tick, find };
}

const offerFrom = (actor: FriendshipActor, id: string, target = ALICE_URL) => ({
    id,
    target,
    relationshipId: `${actor.id}#rel-${id}`,
});

describe('こちらから申請する', () => {
    it('申請すると相手の inbox へ Offer{Relationship friendOf} を送り、承認でフレンドになる', async () => {
        const { friendships, sent, find, notes } = setup();
        expect(await friendships.request('alice', BOB)).toEqual({ ok: true, friendship: 'outgoing' });
        const offer = sent[0]?.activity as {
            id: string;
            type: string;
            actor: string;
            object: { relationship: string };
        };
        expect(offer).toMatchObject({ type: 'Offer', actor: ALICE_URL, target: BOB.id });
        await friendships.onAccept(BOB, {
            id: 'https://c.example/ap/activities/acc',
            object: { id: offer.id, type: 'Offer' },
        });
        expect(friendshipViewOf(find('alice', BOB.id))).toBe('friends');
        expect(notes).toEqual([`accepted ${BOB.id} → alice`]);
    });

    it('ほかの人からの承認・知らない申請への承認は受けない（偽の承認）', async () => {
        const { friendships, sent, find } = setup();
        await friendships.request('alice', BOB);
        const offerId = String(sent[0]?.activity.id);
        await friendships.onAccept(CAROL, {
            id: 'https://c.example/ap/activities/x',
            object: { id: offerId, type: 'Offer' },
        });
        await friendships.onAccept(BOB, {
            id: 'https://c.example/ap/activities/y',
            object: { id: 'https://a.example/ap/activities/other', type: 'Offer' },
        });
        expect(find('alice', BOB.id)?.state).toBe('outgoing');
    });

    it('お互いに申請したら、相手の申請を承認してフレンドになる（1 回だけ）', async () => {
        const { friendships, sent, find, notes } = setup();
        await friendships.request('alice', BOB);
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        expect(find('alice', BOB.id)?.state).toBe('accepted');
        expect(sent.at(-1)?.activity).toMatchObject({
            type: 'Accept',
            object: { id: 'https://c.example/ap/activities/o1' },
        });
        expect(notes).toEqual([`accepted ${BOB.id} → alice`]);
    });

    it('つながりを受けないドメイン・消えた actor には申請しない', async () => {
        expect(await setup({ policy: 'limit' }).friendships.request('alice', BOB)).toEqual({
            ok: false,
            reason: 'domain-limited',
        });
        expect(await setup().friendships.request('alice', { ...BOB, deletedAt: new Date() })).toEqual({
            ok: false,
            reason: 'gone',
        });
    });
});

describe('相手から申請が来る', () => {
    it('申請が届くと通知し、同じ相手から何度届いても通知は 1 回', async () => {
        const { friendships, find, notes } = setup();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o2'));
        expect(find('alice', BOB.id)).toMatchObject({
            state: 'incoming',
            offerId: 'https://c.example/ap/activities/o2',
        });
        expect(notes).toEqual([`requested ${BOB.id} → alice`]);
    });

    it('承認すると、相手の Offer を指す Accept を送ってフレンドになる', async () => {
        const { friendships, sent, find } = setup();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        expect(await friendships.accept('alice', BOB)).toBe(true);
        expect(find('alice', BOB.id)?.state).toBe('accepted');
        expect(sent.at(-1)?.activity).toMatchObject({
            type: 'Accept',
            actor: ALICE_URL,
            object: { id: 'https://c.example/ap/activities/o1', type: 'Offer' },
        });
    });

    it('このサーバーにいない人・自分のサーバーの人でない宛先への申請は無視する', async () => {
        const { friendships, rows } = setup();
        await friendships.onOffer(
            BOB,
            offerFrom(BOB, 'https://c.example/ap/activities/o1', identity.actorUrl('ghost')),
        );
        await friendships.onOffer(
            BOB,
            offerFrom(BOB, 'https://c.example/ap/activities/o2', 'https://evil.example/ap/users/alice'),
        );
        expect(rows).toEqual([]);
    });

    it('断ると Reject を送り、7 日は同じ相手からの申請を受けない', async () => {
        const { friendships, sent, find, notes, tick } = setup();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        await friendships.remove('alice', BOB);
        expect(sent.at(-1)?.activity).toMatchObject({
            type: 'Reject',
            object: { id: 'https://c.example/ap/activities/o1' },
        });
        tick(FEDERATION_LIMITS.REJECT_COOLDOWN_MS - 1);
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o2'));
        expect(find('alice', BOB.id)?.state).toBe('rejected');
        tick(1);
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o3'));
        expect(find('alice', BOB.id)?.state).toBe('incoming');
        expect(notes.filter((n) => n.startsWith('requested'))).toHaveLength(2);
    });

    it('受けた申請は 1 人 100 件まで', async () => {
        const { friendships, rows } = setup();
        for (const n of Array.from({ length: FEDERATION_LIMITS.MAX_PENDING_FRIEND_REQUESTS + 1 }, (_, i) => i)) {
            const actor = {
                ...BOB,
                id: `https://c.example/ap/users/u${n}`,
                inbox: `https://c.example/ap/users/u${n}/inbox`,
            };
            await friendships.onOffer(actor, offerFrom(actor, `https://c.example/ap/activities/o${n}`));
        }
        expect(rows).toHaveLength(FEDERATION_LIMITS.MAX_PENDING_FRIEND_REQUESTS);
    });

    it('つながりを受けないドメインからの申請は無視する（今のフレンドからの申請の再送には承認を返す）', async () => {
        const { friendships, rows } = setup({ policy: 'limit' });
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        expect(rows).toEqual([]);
    });
});

describe('取り消し・解除', () => {
    it('こちらの申請でフレンドになった関係を解除すると Undo{Offer}、相手の申請なら Undo{Accept}', async () => {
        const mine = setup();
        await mine.friendships.request('alice', BOB);
        const offerId = String(mine.sent[0]?.activity.id);
        await mine.friendships.onAccept(BOB, {
            id: 'https://c.example/ap/activities/acc',
            object: { id: offerId, type: 'Offer' },
        });
        await mine.friendships.remove('alice', BOB);
        expect(mine.sent.at(-1)?.activity).toMatchObject({ type: 'Undo', object: { id: offerId, type: 'Offer' } });

        const theirs = setup();
        await theirs.friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        await theirs.friendships.accept('alice', BOB);
        const acceptId = theirs.find('alice', BOB.id)?.acceptId;
        await theirs.friendships.remove('alice', BOB);
        expect(theirs.sent.at(-1)?.activity).toMatchObject({ type: 'Undo', object: { id: acceptId, type: 'Accept' } });
        expect(theirs.find('alice', BOB.id)).toBeUndefined();
    });

    it('相手が申請を取り消すと消え、その申請が遅れて届いても受けない', async () => {
        const { friendships, find, notes } = setup();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        await friendships.onUndo(BOB, { object: { id: 'https://c.example/ap/activities/o1', type: 'Offer' } });
        expect(find('alice', BOB.id)).toBeUndefined();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        expect(find('alice', BOB.id)).toBeUndefined();
        expect(notes).toEqual([`requested ${BOB.id} → alice`, `removed alice × ${BOB.id}`]);
    });

    it('ほかの人の activity を取り消す Undo は無視する', async () => {
        const { friendships, find } = setup();
        await friendships.onOffer(BOB, offerFrom(BOB, 'https://c.example/ap/activities/o1'));
        await friendships.onUndo(CAROL, { object: { id: 'https://c.example/ap/activities/o1', type: 'Offer' } });
        await friendships.onUndo(BOB, { object: { id: 'https://evil.example/ap/activities/o1', type: 'Offer' } });
        expect(find('alice', BOB.id)?.state).toBe('incoming');
    });

    it('actor が消えたら、その actor との関係をすべて消す', async () => {
        const { friendships, rows, notes } = setup();
        await friendships.onOffer(
            BOB,
            offerFrom(BOB, 'https://c.example/ap/activities/o1', identity.actorUrl('alice')),
        );
        await friendships.onOffer(
            BOB,
            offerFrom(BOB, 'https://c.example/ap/activities/o2', identity.actorUrl('user2')),
        );
        await friendships.onActorDeleted(BOB.id);
        expect(rows).toEqual([]);
        expect(notes.filter((n) => n.startsWith('removed'))).toHaveLength(2);
    });
});
