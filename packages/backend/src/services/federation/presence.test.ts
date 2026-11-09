import { FEDERATION_FEATURES, type PresenceEntry, type PresenceVisibility, type RoomCard } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from './identity';
import { createFederatedPresence, limitFriendPresence } from './presence';
import type { FederationResponse } from './transport';

const identity = createFederationIdentity('https://a.example');
const NOW = Date.parse('2026-11-07T00:00:00Z');
const VIEWER = 'https://b.example/ap/users/bob';
const card = (id: string): RoomCard => ({
    id,
    name: '森',
    image: null,
    accessType: 'invite_only',
    members: 2,
    capacity: 10,
    leader: 'https://c.example/ap/users/leader',
    world: { url: 'https://c.example/worlds/forest', name: '森' },
});
const REMOTE_ROOM = card('https://c.example/ap/instances/r1');
const ok = (json: unknown): FederationResponse => ({
    status: 200,
    contentType: 'application/json',
    json,
    retryAfter: null,
});

interface Setup {
    friends?: Record<string, string[]>;
    localRooms?: Record<string, string>;
    visible?: Record<string, boolean>;
    visits?: Record<string, RoomCard>;
    reply?: (url: string, body: unknown) => FederationResponse;
    /** 現在地に答えないと分かっているサーバー */
    noPresence?: string[];
    /** 本人の見せ方（無ければ location） */
    visibility?: Record<string, PresenceVisibility>;
}

function setup(options: Setup = {}) {
    const calls: Array<{ url: string; body: unknown; signAs: unknown }> = [];
    const clock = { now: NOW };
    const presence = createFederatedPresence({
        identity,
        transport: {
            post: async (url, body, o) => {
                calls.push({ url, body, signAs: o.signAs });
                return (
                    options.reply?.(url, body) ?? {
                        status: 503,
                        contentType: undefined,
                        json: undefined,
                        retryAfter: null,
                    }
                );
            },
        },
        policyOf: (domain) => (domain === 'evil.example' ? 'block' : 'allow'),
        lacks: async (domain, feature) =>
            feature === FEDERATION_FEATURES.presence && (options.noPresence ?? []).includes(domain),
        isFriend: async (userId, actorId) => (options.friends?.[userId] ?? []).includes(actorId),
        visibilityOf: async (userId) => options.visibility?.[userId] ?? 'location',
        localRoomOf: async (userId) => options.localRooms?.[userId],
        describeRoom: async (_viewer, instanceId) =>
            options.visible?.[instanceId] === undefined
                ? undefined
                : { room: card(identity.instanceUrl(instanceId)), canJoin: options.visible[instanceId] ?? false },
        visitsOf: async (userIds) =>
            userIds.flatMap((userId) => {
                const room = options.visits?.[userId];
                return room ? [{ userId, roomUrl: room.id, room }] : [];
            }),
        now: () => clock.now,
    });
    return { presence, calls, clock };
}

describe('現在地を答える（見られる人のホームとして）', () => {
    it('フレンドでない人には、いるかどうかも伏せる', async () => {
        const { presence } = setup({ localRooms: { alice: 'r1' }, visible: { r1: true } });
        const answer = await presence.answer(VIEWER, [identity.actorUrl('alice'), 'https://evil.example/ap/users/x']);
        expect(answer.presence.map((p) => p.status)).toEqual(['offline', 'offline']);
    });

    it('このサーバーの部屋: 見えれば部屋と入れるか、見えなければ private', async () => {
        const { presence } = setup({
            friends: { alice: [VIEWER], dave: [VIEWER] },
            localRooms: { alice: 'r1', dave: 'r2' },
            visible: { r1: false },
        });
        const answer = await presence.answer(VIEWER, [identity.actorUrl('alice'), identity.actorUrl('dave')]);
        expect(answer.presence).toEqual([
            {
                subject: identity.actorUrl('alice'),
                status: 'in_room',
                room: card(identity.instanceUrl('r1')),
                joinable: false,
            },
            { subject: identity.actorUrl('dave'), status: 'private' },
        ]);
        expect(answer.ttl).toBe(15);
    });

    it('来訪中: 部屋のサーバーに Application actor で尋ね、見えると答えたときだけ部屋を出す', async () => {
        const { presence, calls } = setup({
            friends: { alice: [VIEWER] },
            visits: { alice: REMOTE_ROOM },
            reply: (_url, body) => {
                const viewers = (body as { viewers: string[] }).viewers;
                return ok({
                    results: viewers.map((viewer) => ({ viewer, visible: true, joinable: false })),
                    room: REMOTE_ROOM,
                    ttl: 30,
                });
            },
        });
        const answer = await presence.answer(VIEWER, [identity.actorUrl('alice')]);
        expect(answer.presence[0]).toEqual({
            subject: identity.actorUrl('alice'),
            status: 'in_room',
            room: REMOTE_ROOM,
            joinable: false,
        });
        expect(calls[0]).toEqual({
            url: 'https://c.example/federation/v1/rooms/visibility',
            body: { room: REMOTE_ROOM.id, member: identity.actorUrl('alice'), viewers: [VIEWER] },
            signAs: { kind: 'app' },
        });
    });

    it('部屋のサーバーが答えない・見えないと答えたら private', async () => {
        const down = setup({ friends: { alice: [VIEWER] }, visits: { alice: REMOTE_ROOM } });
        expect((await down.presence.answer(VIEWER, [identity.actorUrl('alice')])).presence[0]?.status).toBe('private');
        const hidden = setup({
            friends: { alice: [VIEWER] },
            visits: { alice: REMOTE_ROOM },
            reply: () => ok({ results: [{ viewer: VIEWER, visible: false, joinable: false }], ttl: 30 }),
        });
        expect((await hidden.presence.answer(VIEWER, [identity.actorUrl('alice')])).presence[0]?.status).toBe(
            'private',
        );
    });

    it('同じ人を何度書いても 1 度だけ答える', async () => {
        const { presence } = setup({ friends: { alice: [VIEWER] } });
        const alice = identity.actorUrl('alice');
        expect((await presence.answer(VIEWER, [alice, alice, alice])).presence).toHaveLength(1);
    });
});

describe('本人の見せ方（オンライン状態の設定）', () => {
    it('答える側: 見せないならフレンドにもオフライン、オンラインだけなら部屋を伏せて private', async () => {
        const { presence } = setup({
            friends: { alice: [VIEWER], dave: [VIEWER], erin: [VIEWER] },
            localRooms: { alice: 'r1', dave: 'r1', erin: 'r1' },
            visible: { r1: true },
            visibility: { alice: 'hidden', dave: 'online' },
        });
        const answer = await presence.answer(
            VIEWER,
            ['alice', 'dave', 'erin'].map((u) => identity.actorUrl(u)),
        );
        expect(answer.presence).toEqual([
            { subject: identity.actorUrl('alice'), status: 'offline' },
            { subject: identity.actorUrl('dave'), status: 'private' },
            {
                subject: identity.actorUrl('erin'),
                status: 'in_room',
                room: card(identity.instanceUrl('r1')),
                joinable: true,
            },
        ]);
    });

    it('オンラインだけでも、部屋にいなければオフラインのまま（いないのにオンラインとは言わない）', async () => {
        const { presence } = setup({ friends: { dave: [VIEWER] }, visibility: { dave: 'online' } });
        const answer = await presence.answer(VIEWER, [identity.actorUrl('dave')]);
        expect(answer.presence).toEqual([{ subject: identity.actorUrl('dave'), status: 'offline' }]);
    });

    it('見る側: 来訪中のフレンドの答えを本人の見せ方で狭める（最後に確かめた場所も伏せる）', () => {
        const found = {
            friendId: 'dave',
            status: 'in_room' as const,
            room: REMOTE_ROOM,
            joinable: true,
        };
        expect(limitFriendPresence(found, 'location')).toBe(found);
        expect(limitFriendPresence(found, 'online')).toEqual({ friendId: 'dave', status: 'private' });
        expect(limitFriendPresence(found, 'hidden')).toEqual({ friendId: 'dave', status: 'offline' });
        expect(
            limitFriendPresence(
                {
                    friendId: 'dave',
                    status: 'unreachable',
                    lastKnown: { status: 'in_room', room: REMOTE_ROOM, at: NOW },
                },
                'online',
            ),
        ).toEqual({ friendId: 'dave', status: 'unreachable', lastKnown: { status: 'private', at: NOW } });
    });
});

describe('フレンドの現在地を尋ねる（見る人のホームとして）', () => {
    const remoteAnswer = (entries: PresenceEntry[]) => ok({ presence: entries, ttl: 15 });

    it('ホームごとにまとめて見る人の鍵で尋ね、尋ねていない人の答えは使わない', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const carol = 'https://b.example/ap/users/carol';
        const { presence, calls } = setup({
            reply: () =>
                remoteAnswer([
                    { subject: bob, status: 'in_room', room: REMOTE_ROOM, joinable: true },
                    { subject: carol, status: 'private' },
                    { subject: 'https://b.example/ap/users/stranger', status: 'in_room', room: REMOTE_ROOM },
                ]),
        });
        const found = await presence.locate('alice', { remote: [bob, carol], localVisiting: [] });
        expect(found).toEqual([
            { friendId: bob, status: 'in_room', room: REMOTE_ROOM, joinable: true },
            { friendId: carol, status: 'private' },
        ]);
        expect(calls).toEqual([
            {
                url: 'https://b.example/federation/v1/presence',
                body: { subjects: [bob, carol] },
                signAs: { kind: 'user', userId: 'alice' },
            },
        ]);
    });

    it('連合しないサーバーの人には尋ねない。答えは 15 秒使い回す', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const { presence, calls, clock } = setup({ reply: () => remoteAnswer([{ subject: bob, status: 'offline' }]) });
        await presence.locate('alice', { remote: [bob, 'https://evil.example/ap/users/x'], localVisiting: [] });
        await presence.locate('alice', { remote: [bob], localVisiting: [] });
        expect(calls).toHaveLength(1);
        clock.now += 16_000;
        await presence.locate('alice', { remote: [bob], localVisiting: [] });
        expect(calls).toHaveLength(2);
    });

    it('現在地に答えないと分かっているサーバーには尋ねない', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const { presence, calls } = setup({ noPresence: ['b.example'] });
        expect(await presence.locate('alice', { remote: [bob], localVisiting: [] })).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('部屋の無い in_room は private として扱う', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const { presence } = setup({ reply: () => remoteAnswer([{ subject: bob, status: 'in_room' }]) });
        expect(await presence.locate('alice', { remote: [bob], localVisiting: [] })).toEqual([
            { friendId: bob, status: 'private' },
        ]);
    });

    it('つながらないホームの人は、いないとは言わず unreachable にし、最後に確かめた現在地（1 時間以内）を添える', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const net = { up: true };
        const { presence, clock } = setup({
            reply: () =>
                net.up
                    ? remoteAnswer([{ subject: bob, status: 'in_room', room: REMOTE_ROOM, joinable: true }])
                    : { status: 503, contentType: undefined, json: undefined, retryAfter: null },
        });
        await presence.locate('alice', { remote: [bob], localVisiting: [] });
        const seenAt = clock.now;
        net.up = false;
        clock.now += 20_000;
        expect(await presence.locate('alice', { remote: [bob], localVisiting: [] })).toEqual([
            {
                friendId: bob,
                status: 'unreachable',
                lastKnown: { status: 'in_room', room: REMOTE_ROOM, at: seenAt },
            },
        ]);
        clock.now += 60 * 60 * 1000;
        expect(await presence.locate('alice', { remote: [bob], localVisiting: [] })).toEqual([
            { friendId: bob, status: 'unreachable' },
        ]);
    });

    it('ホームが答えない（403 など）なら offline（つながらないのとは分ける）', async () => {
        const bob = 'https://b.example/ap/users/bob';
        const { presence } = setup({
            reply: () => ({ status: 403, contentType: undefined, json: undefined, retryAfter: null }),
        });
        expect(await presence.locate('alice', { remote: [bob], localVisiting: [] })).toEqual([]);
    });

    it('来訪中のフレンドの部屋のサーバーにつながらなければ unreachable、部屋にいなければ offline', async () => {
        const down = setup({ visits: { dave: REMOTE_ROOM } });
        expect(await down.presence.locate('alice', { remote: [], localVisiting: ['dave'] })).toEqual([
            { friendId: 'dave', status: 'unreachable' },
        ]);
        const left = setup({
            visits: { dave: REMOTE_ROOM },
            reply: () => ({ status: 409, contentType: undefined, json: { code: 'not-inside' }, retryAfter: null }),
        });
        expect(await left.presence.locate('alice', { remote: [], localVisiting: ['dave'] })).toEqual([
            { friendId: 'dave', status: 'offline' },
        ]);
    });

    it('答える側では、来訪先の部屋のサーバーにつながらなければ private（約束の状態に unreachable は無い）', async () => {
        const { presence } = setup({ friends: { dave: [VIEWER] }, visits: { dave: REMOTE_ROOM } });
        expect((await presence.answer(VIEWER, [identity.actorUrl('dave')])).presence).toEqual([
            { subject: identity.actorUrl('dave'), status: 'private' },
        ]);
    });

    it('このサーバーのフレンドが来訪中なら、部屋のサーバーに見る人として尋ねる', async () => {
        const { presence, calls } = setup({
            visits: { dave: REMOTE_ROOM },
            reply: () =>
                ok({ results: [{ viewer: identity.actorUrl('alice'), visible: true, joinable: true }], ttl: 30 }),
        });
        expect(await presence.locate('alice', { remote: [], localVisiting: ['dave', 'erin'] })).toEqual([
            { friendId: 'dave', status: 'in_room', room: REMOTE_ROOM, joinable: true },
        ]);
        expect(calls[0]?.body).toEqual({
            room: REMOTE_ROOM.id,
            member: identity.actorUrl('dave'),
            viewers: [identity.actorUrl('alice')],
        });
    });
});
