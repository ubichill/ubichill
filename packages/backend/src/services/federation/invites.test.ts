import type { RemoteActorRecord } from '@ubichill/db';
import type { GrantResponse, RoomCard } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from './identity';
import { createFederatedInvites } from './invites';

const identity = createFederationIdentity('https://a.example');
const NOW = Date.parse('2026-11-07T00:00:00Z');
const HOUR = 60 * 60 * 1000;
const BOB = 'https://b.example/ap/users/bob';
const CAROL = 'https://c.example/ap/users/carol';
const ROOM: RoomCard = {
    id: 'https://b.example/ap/instances/r1',
    name: '森',
    image: 'https://b.example/forest.webp',
    accessType: 'invite_only',
    members: 2,
    capacity: 10,
    leader: BOB,
    world: { url: 'https://b.example/worlds/forest', name: '森' },
};

const actorRecord = (id: string): RemoteActorRecord => ({
    id,
    account: `${id.split('/').pop()}@${new URL(id).host}`,
    domain: new URL(id).host,
    type: 'Person',
    name: null,
    summary: null,
    icon: null,
    url: null,
    inbox: `${id}/inbox`,
    sharedInbox: null,
    keys: [],
    features: [],
    fetchedAt: new Date(NOW),
    deletedAt: null,
    createdAt: new Date(NOW),
});

interface Setup {
    friends?: Record<string, string[]>;
    visits?: Record<string, RoomCard>;
    grant?: (invitees: string[]) => GrantResponse | null;
    knownActors?: string[];
}

function setup(options: Setup = {}) {
    const sent: Array<{ to: string; activity: Record<string, unknown>; endTime?: Date }> = [];
    const notes: Array<Record<string, unknown>> = [];
    const requests = new Map<string, { expiresAt: Date; activityId?: string | null }>();
    const grants: Array<{ userId: string; roomUrl: string; invitees: string[] }> = [];
    const friendsOf = (id: string) => new Set(options.friends?.[id] ?? []);
    const invites = createFederatedInvites({
        identity,
        allowHttp: false,
        actors: {
            get: async (id) => ((options.knownActors ?? [BOB, CAROL]).includes(id) ? actorRecord(id) : null),
        },
        outbox: {
            send: async (input) =>
                void sent.push({ to: input.to.id, activity: input.activity, endTime: input.endTime }),
        },
        travel: {
            grant: async (userId, roomUrl, input) => {
                grants.push({ userId, roomUrl, invitees: input.invitees });
                return options.grant ? options.grant(input.invitees) : null;
            },
        },
        roomCard: async (instanceId) =>
            instanceId === 'local1' ? { ...ROOM, id: identity.instanceUrl('local1') } : undefined,
        isFriend: async (userId, actorId) => friendsOf(userId).has(actorId),
        friendIdsOf: async (userId) => friendsOf(userId),
        visitOf: async (userId) => {
            const room = options.visits?.[userId];
            return room && { roomUrl: room.id, room };
        },
        userExists: async (userId) => ['alice', 'dave'].includes(userId),
        requests: {
            createRequest: async (input) => {
                const key = `${input.requesterId}|${input.targetId}`;
                if (requests.has(key)) return 'exists';
                requests.set(key, { expiresAt: input.expiresAt, activityId: input.activityId });
                return 'created';
            },
            removeRequest: async (requesterId, targetId) => requests.delete(`${requesterId}|${targetId}`),
        },
        notify: {
            remoteInvited: async (input) => void notes.push({ kind: 'invited', ...input }),
            remoteInviteRequested: async (input) => void notes.push({ kind: 'requested', ...input }),
        },
        now: () => NOW,
    });
    return { invites, sent, notes, requests, grants };
}

describe('このサーバーの部屋から、ほかのサーバーの人へ', () => {
    it('Invite に部屋の作りと期限を載せ、送る人の鍵で届ける', async () => {
        const { invites, sent } = setup();
        const expiresAt = new Date(NOW + HOUR);
        expect(
            await invites.deliverInvite({
                inviterId: 'alice',
                inviteeId: BOB,
                instanceId: 'local1',
                message: 'おいで',
                expiresAt,
            }),
        ).toBe(true);
        expect(sent[0]).toMatchObject({
            to: BOB,
            endTime: expiresAt,
            activity: {
                type: 'Invite',
                actor: identity.actorUrl('alice'),
                target: BOB,
                object: { id: identity.instanceUrl('local1'), type: 'Instance', name: '森', accessType: 'invite_only' },
                content: 'おいで',
                endTime: expiresAt.toISOString(),
            },
        });
    });

    it('相手を引けない・部屋が無いなら届けない', async () => {
        const { invites, sent } = setup({ knownActors: [] });
        const input = {
            inviterId: 'alice',
            inviteeId: BOB,
            instanceId: 'local1',
            message: null,
            expiresAt: new Date(NOW + HOUR),
        };
        expect(await invites.deliverInvite(input)).toBe(false);
        expect(await setup().invites.deliverInvite({ ...input, instanceId: 'nope' })).toBe(false);
        expect(sent).toHaveLength(0);
    });
});

describe('来訪中のほかのサーバーの部屋から招待する', () => {
    const visiting = { alice: ROOM };

    it('その部屋にいなければ null（ほかの部屋の住所では送れない）', async () => {
        const { invites, grants } = setup({ visits: visiting, friends: { alice: ['dave'] } });
        expect(await invites.sendFromRemoteRoom('alice', 'other@b.example', ['dave'], null)).toBeNull();
        expect(await invites.sendFromRemoteRoom('dave', 'r1@b.example', ['alice'], null)).toBeNull();
        expect(grants).toHaveLength(0);
    });

    it('フレンドでない人・自分には頼まず、部屋のサーバーに権利を頼む', async () => {
        const { invites, grants } = setup({
            visits: visiting,
            friends: { alice: ['dave', CAROL] },
            grant: (invitees) => ({ results: invitees.map((invitee) => ({ invitee, granted: true })) }),
        });
        const results = await invites.sendFromRemoteRoom(
            'alice',
            'r1@b.example',
            ['dave', CAROL, 'mallory', 'alice'],
            null,
        );
        expect(results).toEqual([
            { userId: 'dave', ok: true },
            { userId: CAROL, ok: true },
            { userId: 'mallory', ok: false, reason: 'not-friend' },
            { userId: 'alice', ok: false, reason: 'self' },
        ]);
        expect(grants).toEqual([{ userId: 'alice', roomUrl: ROOM.id, invitees: [identity.actorUrl('dave'), CAROL] }]);
    });

    it('このサーバーの人には通知、ほかのサーバーの人には Invite（部屋は部屋のサーバーの住所）', async () => {
        const { invites, notes, sent } = setup({
            visits: visiting,
            friends: { alice: ['dave', CAROL] },
            grant: (invitees) => ({
                results: invitees.map((invitee) => ({
                    invitee,
                    granted: true,
                    expiresAt: new Date(NOW + HOUR).toISOString(),
                })),
                room: ROOM,
            }),
        });
        await invites.sendFromRemoteRoom('alice', 'r1@b.example', ['dave', CAROL], 'こっち');
        expect(notes).toEqual([
            {
                kind: 'invited',
                from: { userId: 'alice' },
                inviteeId: 'dave',
                room: { address: 'r1@b.example', url: ROOM.id, name: '森', image: ROOM.image },
                message: 'こっち',
                expiresAt: new Date(NOW + HOUR),
            },
        ]);
        expect(sent[0]).toMatchObject({
            to: CAROL,
            activity: { type: 'Invite', object: { id: ROOM.id }, content: 'こっち' },
        });
    });

    it('部屋のサーバーが断った理由はそのまま、知らない理由と無応答は unavailable', async () => {
        const { invites, notes, sent } = setup({
            visits: visiting,
            friends: { alice: ['dave', CAROL] },
            grant: (invitees) => ({
                results: [
                    { invitee: invitees[0] ?? '', granted: false, reason: 'needs-leader' },
                    { invitee: invitees[1] ?? '', granted: false, reason: 'not-allowed' },
                ],
            }),
        });
        expect(await invites.sendFromRemoteRoom('alice', 'r1@b.example', ['dave', CAROL], null)).toEqual([
            { userId: 'dave', ok: false, reason: 'needs-leader' },
            { userId: CAROL, ok: false, reason: 'unavailable' },
        ]);
        const down = setup({ visits: visiting, friends: { alice: ['dave'] } });
        expect(await down.invites.sendFromRemoteRoom('alice', 'r1@b.example', ['dave'], null)).toEqual([
            { userId: 'dave', ok: false, reason: 'unavailable' },
        ]);
        expect(notes).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });

    it('部屋のサーバーが別の部屋の作りを返しても、来訪中の部屋の作りを使う', async () => {
        const { invites, notes } = setup({
            visits: visiting,
            friends: { alice: ['dave'] },
            grant: (invitees) => ({
                results: invitees.map((invitee) => ({ invitee, granted: true })),
                room: { ...ROOM, id: 'https://evil.example/ap/instances/x', name: '偽物' },
            }),
        });
        await invites.sendFromRemoteRoom('alice', 'r1@b.example', ['dave'], null);
        expect(notes[0]).toMatchObject({ room: { address: 'r1@b.example', name: '森' } });
    });
});

describe('受けた招待・リクエスト', () => {
    const invite = (overrides: Partial<{ target: string; endTime: string; room: RoomCard }> = {}) => ({
        target: overrides.target ?? identity.actorUrl('alice'),
        room: { id: (overrides.room ?? ROOM).id, name: '森', image: ROOM.image },
        content: 'おいで',
        endTime: overrides.endTime ?? new Date(NOW + HOUR).toISOString(),
    });

    it('フレンドからの招待は通知になり、こちらのリクエストは片付く', async () => {
        const { invites, notes, requests } = setup({ friends: { alice: [BOB] } });
        requests.set(`alice|${BOB}`, { expiresAt: new Date(NOW + HOUR) });
        await invites.onInvite({ id: BOB }, invite());
        expect(notes[0]).toMatchObject({
            kind: 'invited',
            from: { actorUri: BOB },
            inviteeId: 'alice',
            room: { address: 'r1@b.example', url: ROOM.id },
            message: 'おいで',
        });
        expect(requests.size).toBe(0);
    });

    it('このサーバーの部屋への招待は、住所を部屋の ID にする', async () => {
        const { invites, notes } = setup({ friends: { alice: [BOB] } });
        await invites.onInvite({ id: BOB }, invite({ room: { ...ROOM, id: identity.instanceUrl('local1') } }));
        expect(notes[0]).toMatchObject({ room: { address: 'local1' } });
    });

    it('フレンドでない人・いないユーザー・期限切れ・読めない部屋は捨てる', async () => {
        const { invites, notes } = setup({ friends: { alice: [BOB] } });
        await invites.onInvite({ id: CAROL }, invite());
        await invites.onInvite({ id: BOB }, invite({ target: identity.actorUrl('ghost') }));
        await invites.onInvite({ id: BOB }, invite({ endTime: new Date(NOW - 1).toISOString() }));
        await invites.onInvite({ id: BOB }, invite({ room: { ...ROOM, id: 'javascript:alert(1)' } }));
        expect(notes).toHaveLength(0);
    });

    it('期限は最長 24 時間に縮める', async () => {
        const { invites, notes } = setup({ friends: { alice: [BOB] } });
        await invites.onInvite({ id: BOB }, invite({ endTime: new Date(NOW + 1000 * HOUR).toISOString() }));
        expect(notes[0]?.expiresAt).toEqual(new Date(NOW + 24 * HOUR));
    });

    it('リクエストは期限内に 1 度だけ通知し、届いた activity の id を覚える', async () => {
        const { invites, notes, requests } = setup({ friends: { alice: [BOB] } });
        const request = {
            id: 'https://b.example/ap/activities/r1',
            target: identity.actorUrl('alice'),
            endTime: new Date(NOW + HOUR).toISOString(),
        };
        await invites.onRequestInvite({ id: BOB }, request);
        await invites.onRequestInvite({ id: BOB }, request);
        expect(notes.filter((n) => n.kind === 'requested')).toHaveLength(1);
        expect(requests.get(`${BOB}|alice`)?.activityId).toBe(request.id);
        await invites.onRequestInvite({ id: CAROL }, request);
        expect(notes).toHaveLength(1);
    });
});

describe('ほかのサーバーのフレンドへリクエストを送る', () => {
    it('フレンドにだけ、期限内に 1 度だけ送る', async () => {
        const { invites, sent } = setup({ friends: { alice: [BOB] } });
        expect(await invites.requestRemote('alice', BOB)).toEqual({ ok: true, alreadyRequested: false });
        expect(await invites.requestRemote('alice', BOB)).toEqual({ ok: true, alreadyRequested: true });
        expect(await invites.requestRemote('alice', CAROL)).toEqual({ ok: false, reason: 'not-friend' });
        expect(sent).toHaveLength(1);
        expect(sent[0]?.activity).toMatchObject({
            type: 'RequestInvite',
            actor: identity.actorUrl('alice'),
            object: BOB,
        });
    });
});
