import { type DomainPolicy, FEDERATION_FEATURES, INSTANCE_PROTOCOL_VERSION, type RoomCard } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from '../identity';
import type { FederationResponse, SignAs } from '../transport/transport';
import { createTravel } from './travel';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const ROOM: RoomCard = {
    id: 'https://b.example/ap/instances/room1',
    name: 'Garden',
    image: null,
    accessType: 'public',
    members: 1,
    capacity: 10,
    leader: 'https://b.example/ap/users/leader',
    world: { url: 'https://b.example/worlds/garden', name: 'Garden' },
};
const JOINED = {
    ticket: 't1',
    wsUrl: 'wss://b.example/realtime/v1/ws',
    expiresAt: new Date(NOW + 120_000).toISOString(),
    room: ROOM,
    participant: { id: 'https://a.example/ap/users/alice', name: 'alice' },
    protocolVersion: 1,
};

type Call = { method: 'GET' | 'POST'; url: string; body?: unknown; signAs: SignAs; nonce?: boolean };

function setup(
    options: {
        reply?: (call: Call) => FederationResponse | Error;
        policy?: DomainPolicy;
        allowHttp?: boolean;
        lacking?: string[];
    } = {},
) {
    const calls: Call[] = [];
    const visits = new Map<string, { roomUrl: string; room: RoomCard }>();
    const respond = (call: Call) => {
        calls.push(call);
        const reply = options.reply?.(call) ?? {
            status: 404,
            contentType: undefined,
            json: undefined,
            retryAfter: null,
        };
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    };
    const travel = createTravel({
        identity: createFederationIdentity('https://a.example'),
        allowHttp: options.allowHttp ?? false,
        transport: {
            get: (url, o) => respond({ method: 'GET', url, signAs: o.signAs }),
            post: (url, body, o) => respond({ method: 'POST', url, body, signAs: o.signAs, nonce: o.nonce }),
        },
        policyOf: () => options.policy ?? 'allow',
        lacks: async (_domain, feature) => (options.lacking ?? []).includes(feature),
        visits: {
            set: async (userId, roomUrl, room) => void visits.set(userId, { roomUrl, room }),
            touch: async (userId, roomUrl) => visits.get(userId)?.roomUrl === roomUrl,
            clear: async (userId) => void visits.delete(userId),
        },
        now: () => NOW,
    });
    return { travel, calls, visits };
}

const ok = (json: unknown): FederationResponse => ({
    status: 200,
    contentType: 'application/json',
    json,
    retryAfter: null,
});
const fail = (status: number, code?: string): FederationResponse => ({
    status,
    contentType: 'application/problem+json',
    json: code ? { code } : undefined,
    retryAfter: null,
});
const ADDRESS = { id: 'room1', domain: 'b.example' };

describe('ほかのサーバーの部屋を見る（describe）', () => {
    it('ユーザーの鍵で部屋のサーバーに尋ねる', async () => {
        const { travel, calls } = setup({ reply: () => ok({ room: ROOM, canJoin: true }) });
        expect(await travel.describe('alice', ADDRESS)).toEqual({
            ok: true,
            room: ROOM,
            canJoin: true,
            incompatible: false,
        });
        expect(calls).toEqual([
            { method: 'GET', url: 'https://b.example/ap/instances/room1', signAs: { kind: 'user', userId: 'alice' } },
        ]);
    });

    it('連合しないサーバーには尋ねない', async () => {
        const { travel, calls } = setup({ policy: 'block' });
        expect(await travel.describe('alice', ADDRESS)).toEqual({ ok: false, error: 'blocked' });
        expect(calls).toHaveLength(0);
    });

    it('別のサーバーの部屋を名乗る答えは使わない', async () => {
        const { travel } = setup({
            reply: () => ok({ room: { ...ROOM, id: 'https://c.example/ap/instances/room1' }, canJoin: true }),
        });
        expect(await travel.describe('alice', ADDRESS)).toEqual({ ok: false, error: 'unavailable' });
    });

    it('見えない部屋は not-found、つながらなければ unavailable', async () => {
        expect(await setup({ reply: () => fail(404) }).travel.describe('alice', ADDRESS)).toEqual({
            ok: false,
            error: 'not-found',
        });
        expect(await setup({ reply: () => new Error('ECONNREFUSED') }).travel.describe('alice', ADDRESS)).toEqual({
            ok: false,
            error: 'unavailable',
        });
    });

    it('開発では https でつながらなければ http を試す', async () => {
        const { travel, calls } = setup({
            allowHttp: true,
            reply: (call) =>
                call.url.startsWith('https:') ? new Error('ECONNREFUSED') : ok({ room: ROOM, canJoin: true }),
        });
        expect(await travel.describe('alice', ADDRESS)).toMatchObject({ ok: true });
        expect(calls.map((c) => c.url)).toEqual([
            'https://b.example/ap/instances/room1',
            'http://b.example/ap/instances/room1',
        ]);
    });
});

describe('ほかのサーバーの部屋に入る（join）', () => {
    it('ユーザーの鍵と nonce で頼み、チケットを画面の形で返し、現在地として覚える', async () => {
        const { travel, calls, visits } = setup({ reply: () => ok(JOINED) });
        const result = await travel.join('alice', ADDRESS, 'https://a.example');
        expect(result).toEqual({
            ok: true,
            room: ROOM,
            grant: {
                token: 't1',
                url: 'wss://b.example/realtime/v1/ws',
                expiresAt: NOW + 120_000,
                userId: 'https://a.example/ap/users/alice',
                protocolVersion: 1,
            },
        });
        expect(calls[0]).toMatchObject({
            method: 'POST',
            url: 'https://b.example/federation/v1/rooms/join',
            body: { room: 'https://b.example/ap/instances/room1', clientOrigin: 'https://a.example' },
            signAs: { kind: 'user', userId: 'alice' },
            nonce: true,
        });
        expect(visits.get('alice')?.roomUrl).toBe(ROOM.id);
    });

    it('部屋のサーバーと別のホストの WebSocket にはつながせない', async () => {
        for (const wsUrl of [
            'wss://evil.example/ws',
            'ws://b.example/ws',
            'https://b.example/ws',
            'wss://user:pw@b.example/ws',
        ]) {
            const { travel, visits } = setup({ reply: () => ok({ ...JOINED, wsUrl }) });
            expect(await travel.join('alice', ADDRESS, 'https://a.example')).toEqual({
                ok: false,
                error: 'unavailable',
            });
            expect(visits.size).toBe(0);
        }
    });

    it('開発では ws の Go（ポート違い）を受ける', async () => {
        const dev = { id: 'room1', domain: 'localhost:3201' };
        const room = { ...ROOM, id: 'http://localhost:3201/ap/instances/room1' };
        const { travel } = setup({
            allowHttp: true,
            reply: () => ok({ ...JOINED, room, wsUrl: 'ws://localhost:3202/realtime/v1/ws' }),
        });
        expect(await travel.join('alice', dev, 'http://localhost:3100')).toMatchObject({ ok: true });
    });

    it('断られた理由を画面の言葉に分ける', async () => {
        const cases: Array<[FederationResponse, string]> = [
            [fail(403, 'invite-required'), 'invite-required'],
            [fail(409, 'full'), 'full'],
            [fail(404, 'not-found'), 'not-found'],
            [fail(403, 'domain-limited'), 'rejected'],
            [fail(429, 'rate-limited'), 'rejected'],
            [fail(503), 'unavailable'],
            [ok({ ticket: 't1' }), 'unavailable'],
        ];
        for (const [reply, error] of cases) {
            const { travel, visits } = setup({ reply: () => reply });
            expect(await travel.join('alice', ADDRESS, 'https://a.example')).toEqual({ ok: false, error });
            expect(visits.size).toBe(0);
        }
    });
});

describe('対応していない部屋のサーバー・版の合わない部屋', () => {
    it('来訪に対応していないと分かっていれば、尋ねも入りもせず unsupported', async () => {
        const { travel, calls } = setup({ lacking: [FEDERATION_FEATURES.visit] });
        expect(await travel.describe('alice', ADDRESS)).toEqual({ ok: false, error: 'unsupported' });
        expect(await travel.join('alice', ADDRESS, 'https://a.example')).toEqual({ ok: false, error: 'unsupported' });
        expect(calls).toEqual([]);
    });

    it('版の合わない部屋は、見せるが入れない（移動する前に分かる）。入室で版が合わなければ来訪として覚えない', async () => {
        const newer = { ...ROOM, protocolVersion: INSTANCE_PROTOCOL_VERSION + 1 };
        const { travel, visits } = setup({
            reply: (call) =>
                call.method === 'GET'
                    ? ok({ room: newer, canJoin: true })
                    : ok({ ...JOINED, room: newer, protocolVersion: INSTANCE_PROTOCOL_VERSION + 1 }),
        });
        expect(await travel.describe('alice', ADDRESS)).toEqual({
            ok: true,
            room: newer,
            canJoin: false,
            incompatible: true,
        });
        expect(await travel.join('alice', ADDRESS, 'https://a.example')).toEqual({ ok: false, error: 'incompatible' });
        expect(visits.size).toBe(0);
    });
});

describe('会いに行くフレンド（via）', () => {
    it('部屋の作りの取得には問い合わせに、入室には本文に付けて部屋のサーバーへ渡す', async () => {
        const dave = 'https://c.example/ap/users/dave';
        const { travel, calls } = setup({
            reply: (call) => (call.method === 'GET' ? ok({ room: ROOM, canJoin: true }) : ok(JOINED)),
        });
        await travel.describe('alice', ADDRESS, [dave]);
        await travel.join('alice', ADDRESS, 'https://a.example', [dave]);
        expect(calls[0]?.url).toBe(`https://b.example/ap/instances/room1?via=${encodeURIComponent(dave)}`);
        expect(calls[1]?.body).toMatchObject({ via: [dave] });
        await travel.join('alice', ADDRESS, 'https://a.example');
        expect(calls[2]?.body).not.toHaveProperty('via');
    });
});

describe('来訪の記録が途切れた後（resume）', () => {
    it('通信が戻ったら、部屋のサーバーに尋ね直して来訪を記録し直す', async () => {
        const down = { now: true };
        const { travel, visits } = setup({
            reply: () => (down.now ? new Error('ECONNRESET') : ok({ room: ROOM, canJoin: true })),
        });
        expect(await travel.resume('alice', ADDRESS)).toBe(false);
        expect(visits.has('alice')).toBe(false);
        down.now = false;
        expect(await travel.resume('alice', ADDRESS)).toBe(true);
        expect(visits.get('alice')).toEqual({ roomUrl: ROOM.id, room: ROOM });
        expect(await travel.heartbeat('alice', ROOM.id)).toBe(true);
    });

    it('見えなくなった部屋・連合しないサーバーの部屋は記録し直さない', async () => {
        const hidden = setup({ reply: () => fail(404) });
        expect(await hidden.travel.resume('alice', ADDRESS)).toBe(false);
        const blocked = setup({ policy: 'block', reply: () => ok({ room: ROOM, canJoin: true }) });
        expect(await blocked.travel.resume('alice', ADDRESS)).toBe(false);
        expect([...hidden.visits.keys(), ...blocked.visits.keys()]).toEqual([]);
    });
});

describe('来訪中の部屋に招待する（grant）', () => {
    it('部屋のサーバーに、招く人の鍵と nonce で権利を頼む', async () => {
        const { travel, calls } = setup({
            reply: () => ok({ results: [{ invitee: 'https://c.example/ap/users/bob', granted: true }] }),
        });
        const result = await travel.grant('alice', ROOM.id, {
            inviteId: 'https://a.example/ap/activities/i1',
            invitees: ['https://c.example/ap/users/bob'],
            endTime: new Date(NOW + 60_000),
        });
        expect(result?.results).toEqual([{ invitee: 'https://c.example/ap/users/bob', granted: true }]);
        expect(calls[0]).toMatchObject({
            url: 'https://b.example/federation/v1/rooms/grants',
            body: {
                room: ROOM.id,
                invite: 'https://a.example/ap/activities/i1',
                invitees: ['https://c.example/ap/users/bob'],
                endTime: new Date(NOW + 60_000).toISOString(),
            },
            signAs: { kind: 'user', userId: 'alice' },
            nonce: true,
        });
    });

    it('連合しないサーバー・読めない部屋の URL には頼まない', async () => {
        const blocked = setup({ policy: 'block' });
        const input = { inviteId: 'x', invitees: ['https://c.example/ap/users/bob'], endTime: new Date(NOW) };
        expect(await blocked.travel.grant('alice', ROOM.id, input)).toBeNull();
        expect(await blocked.travel.grant('alice', 'javascript:alert(1)', input)).toBeNull();
        expect(blocked.calls).toHaveLength(0);
    });
});
