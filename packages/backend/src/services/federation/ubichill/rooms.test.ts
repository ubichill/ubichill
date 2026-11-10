import { type AccessType, type DomainPolicy, FEDERATION_LIMITS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from '../identity';
import { createRooms, type RoomRecord, type Visitor } from './rooms';

const identity = createFederationIdentity('https://b.example');
const NOW = Date.parse('2026-11-07T00:00:00Z');
const HOUR = 60 * 60 * 1000;

const visitor = (name: string, domain = 'a.example'): Visitor => ({
    id: `https://${domain}/ap/users/${name}`,
    domain,
    name,
    account: `${name}@${domain}`,
});
const ALICE = visitor('alice');
const MALLORY = visitor('mallory', 'evil.example');

interface Setup {
    accessType?: AccessType;
    maxUsers?: number;
    members?: string[];
    /** その人のフレンド（このサーバーが知っている分） */
    friends?: Record<string, string[]>;
    policy?: Record<string, DomainPolicy>;
    otherRooms?: Record<string, string[]>;
    allowHttp?: boolean;
    /** 中にいるほかのサーバーの人（キー）のホームが、フレンドだと答える人 */
    homes?: Record<string, string[]>;
}

function setup(options: Setup = {}) {
    const room: RoomRecord = {
        id: 'room1',
        leaderId: 'leader',
        accessType: options.accessType ?? 'public',
        maxUsers: options.maxUsers ?? 10,
        worldRef: 'https://b.example/worlds/garden',
    };
    const presence = new Map<string, { memberIds: readonly string[] }>([
        ['room1', { memberIds: options.members ?? ['leader'] }],
        ...Object.entries(options.otherRooms ?? {}).map(([id, memberIds]) => [id, { memberIds }] as const),
    ]);
    const invites: Array<{ instanceId: string; inviterId: string; inviteeId: string; expiresAt: Date }> = [];
    const admitted = new Set<string>();
    const tickets: Array<{ instanceId: string; participant: { id: string; name: string }; origin: string }> = [];
    const asked: string[] = [];
    const rooms = createRooms({
        identity,
        allowHttp: options.allowHttp ?? false,
        policyOf: (domain) => options.policy?.[domain] ?? 'allow',
        rooms: {
            find: async (id) => (id === room.id ? room : undefined),
            look: async () => ({ name: 'Garden', image: 'https://b.example/garden.webp' }),
        },
        presence: async () => presence,
        friendsOf: async (id) => new Set(options.friends?.[id] ?? []),
        askFriendship: async (member, viewer) => {
            asked.push(`${member}|${viewer}`);
            return options.homes?.[member]?.includes(viewer) ?? false;
        },
        invites: {
            findValid: async (instanceId, inviteeId, now) =>
                invites.find((i) => i.instanceId === instanceId && i.inviteeId === inviteeId && i.expiresAt > now),
            upsert: async (input) => void invites.push(input),
        },
        admissions: {
            admit: async (instanceId, actorId) => void admitted.add(`${instanceId}|${actorId}`),
            isAdmitted: async (instanceId, actorId) => admitted.has(`${instanceId}|${actorId}`),
        },
        ticket: async (instanceId, participant, origin) => {
            tickets.push({ instanceId, participant, origin });
            return { token: `ticket-${tickets.length}`, expiresAt: NOW + 120_000, protocolVersion: 1 };
        },
        wsUrl: 'wss://b.example/realtime/v1/ws',
        now: () => NOW,
    });
    return { rooms, room, presence, invites, admitted, tickets, asked };
}

const ROOM_URL = identity.instanceUrl('room1');
const join = { room: ROOM_URL, clientOrigin: 'https://a.example' };

describe('部屋の作り（describe）', () => {
    it('パブリックの部屋は知らない人にも見え、入れる', async () => {
        const { rooms } = setup();
        const result = await rooms.describe(ALICE.id, 'room1');
        expect(result?.canJoin).toBe(true);
        expect(result?.room).toMatchObject({
            id: ROOM_URL,
            name: 'Garden',
            accessType: 'public',
            members: 1,
            capacity: 10,
            leader: identity.actorUrl('leader'),
            world: { url: 'https://b.example/worlds/garden', name: 'Garden' },
        });
    });

    it('招待のみの部屋は、中にいる人のフレンドにだけ見える（招待が無ければ入れない）', async () => {
        const { rooms } = setup({
            accessType: 'invite_only',
            members: ['leader', 'm1'],
            friends: { [ALICE.id]: ['m1'] },
        });
        expect(await rooms.describe(ALICE.id, 'room1')).toMatchObject({ canJoin: false });
        // フレンドでなければ、無い部屋と同じ（あることを伏せる）
        expect(await rooms.describe(MALLORY.id, 'room1')).toBeUndefined();
        expect(await rooms.describe(MALLORY.id, 'nope')).toBeUndefined();
    });

    it('フレンド+: 中にいるほかのサーバーの人のフレンドは、その人のホームが答えれば見えて入れる（このサーバーは関係を知らない）', async () => {
        const CAROL = visitor('carol', 'c.example');
        const DAVE = visitor('dave', 'd.example');
        const { rooms, tickets } = setup({
            accessType: 'friend_plus',
            members: ['leader', CAROL.id],
            homes: { [CAROL.id]: [DAVE.id] },
        });
        expect(await rooms.describe(DAVE.id, 'room1')).toMatchObject({ canJoin: true });
        const joined = await rooms.join(DAVE, { room: ROOM_URL, clientOrigin: 'https://d.example' });
        expect(joined.ok).toBe(true);
        expect(tickets.map((t) => t.participant.id)).toEqual([DAVE.id]);
        // ホームがフレンドだと答えない人には、あることも伏せる
        expect(await rooms.describe(MALLORY.id, 'room1')).toBeUndefined();
        expect(await rooms.join(MALLORY, { room: ROOM_URL, clientOrigin: 'https://evil.example' })).toMatchObject({
            ok: false,
            problem: { status: 404 },
        });
    });

    it('招待のみ: ホームが答えたフレンドにも見えるが、入るには招待が要る', async () => {
        const CAROL = visitor('carol', 'c.example');
        const { rooms } = setup({
            accessType: 'invite_only',
            members: ['leader', CAROL.id],
            homes: { [CAROL.id]: [ALICE.id] },
        });
        expect(await rooms.describe(ALICE.id, 'room1')).toMatchObject({ canJoin: false });
        expect(await rooms.join(ALICE, join)).toMatchObject({ ok: false, problem: { code: 'invite-required' } });
    });

    it('ホームに尋ねるのは、知っている関係で見えないとき・中にいる人のフレンドで決まる部屋・ほかのサーバーの人だけ', async () => {
        const CAROL = visitor('carol', 'c.example');
        const known = setup({
            accessType: 'friend_plus',
            members: ['leader', CAROL.id],
            friends: { [ALICE.id]: ['leader'] },
        });
        await known.rooms.describe(ALICE.id, 'room1');
        expect(known.asked).toEqual([]);

        const leaderOnly = setup({
            accessType: 'friend_only',
            members: ['leader', CAROL.id],
            homes: { [CAROL.id]: [ALICE.id] },
        });
        expect(await leaderOnly.rooms.describe(ALICE.id, 'room1')).toBeUndefined();
        expect(leaderOnly.asked).toEqual([]);

        const many = Array.from(
            { length: FEDERATION_LIMITS.MAX_FRIENDSHIP_CHECKS + 5 },
            (_, i) => visitor(`v${i}`, `h${i}.example`).id,
        );
        const crowded = setup({ accessType: 'friend_plus', members: ['leader', 'local-member', ...many] });
        await crowded.rooms.describe(ALICE.id, 'room1');
        expect(crowded.asked).toHaveLength(FEDERATION_LIMITS.MAX_FRIENDSHIP_CHECKS);
        expect(crowded.asked.every((a) => a.endsWith(`|${ALICE.id}`) && !a.startsWith('local-member'))).toBe(true);
    });

    it('会いに行く人（via）との関係から確かめるので、その人の参加の順・部屋の人数で入れたり入れなかったりしない', async () => {
        const others = Array.from({ length: 10 }, (_, i) => visitor(`v${i}`, `h${i}.example`).id);
        const FRIEND = visitor('friend', 'f.example');
        // 12 人の部屋で、唯一のフレンドが 11 番目のほかのサーバーの来訪者
        const options = {
            accessType: 'friend_plus' as const,
            maxUsers: 16,
            members: ['leader', ...others, FRIEND.id],
            homes: { [FRIEND.id]: [ALICE.id] },
        };
        const withVia = setup(options);
        expect(await withVia.rooms.describe(ALICE.id, 'room1', [FRIEND.id])).toMatchObject({ canJoin: true });
        expect((await withVia.rooms.join(ALICE, { ...join, via: [FRIEND.id] })).ok).toBe(true);
        expect(withVia.asked[0]).toBe(`${FRIEND.id}|${ALICE.id}`);
        // 部屋にいない人を via に入れても、尋ねる数は増えず、入れることにもならない
        const outside = setup({ ...options, members: ['leader', ...others] });
        expect(await outside.rooms.describe(ALICE.id, 'room1', [FRIEND.id])).toBeUndefined();
        expect(outside.asked).toHaveLength(FEDERATION_LIMITS.MAX_FRIENDSHIP_CHECKS);
        expect(outside.asked.some((a) => a.startsWith(FRIEND.id))).toBe(false);
    });

    it('招待があれば、見えない部屋でも入れる', async () => {
        const { rooms, invites } = setup({ accessType: 'invite_only' });
        invites.push({
            instanceId: 'room1',
            inviterId: 'leader',
            inviteeId: ALICE.id,
            expiresAt: new Date(NOW + HOUR),
        });
        expect(await rooms.describe(ALICE.id, 'room1')).toMatchObject({ canJoin: true });
    });

    it('期限の切れた招待は効かない', async () => {
        const { rooms, invites } = setup({ accessType: 'invite_only' });
        invites.push({ instanceId: 'room1', inviterId: 'leader', inviteeId: ALICE.id, expiresAt: new Date(NOW - 1) });
        expect(await rooms.describe(ALICE.id, 'room1')).toBeUndefined();
    });
});

describe('入室（join）', () => {
    it('来訪者のブラウザの origin に結び付けたチケットを出し、入れた人として覚える', async () => {
        const { rooms, tickets, admitted } = setup();
        const result = await rooms.join(ALICE, join);
        expect(result).toMatchObject({
            ok: true,
            value: {
                ticket: 'ticket-1',
                wsUrl: 'wss://b.example/realtime/v1/ws',
                participant: { id: ALICE.id, name: 'alice' },
                protocolVersion: 1,
                room: { id: ROOM_URL },
            },
        });
        expect(tickets[0]).toEqual({
            instanceId: 'room1',
            participant: { id: ALICE.id, name: 'alice' },
            origin: 'https://a.example',
        });
        expect(admitted.has(`room1|${ALICE.id}`)).toBe(true);
    });

    it('来訪者のサーバーでない origin には出さない（チケットを別の画面で使わせない）', async () => {
        const { rooms, tickets } = setup();
        for (const clientOrigin of [
            'https://evil.example',
            'https://a.example/path',
            'https://a.example.evil.example',
            'null',
        ]) {
            const result = await rooms.join(ALICE, { room: ROOM_URL, clientOrigin });
            expect(result).toMatchObject({ ok: false, problem: { status: 400, code: 'bad-request' } });
        }
        expect(tickets).toHaveLength(0);
    });

    it('開発のときだけ http の画面とポート違いを受ける', async () => {
        const local = visitor('alice', 'localhost:3101');
        const strict = setup();
        expect(await strict.rooms.join(local, { room: ROOM_URL, clientOrigin: 'http://localhost:3100' })).toMatchObject(
            { ok: false },
        );
        const dev = setup({ allowHttp: true });
        expect(await dev.rooms.join(local, { room: ROOM_URL, clientOrigin: 'http://localhost:3100' })).toMatchObject({
            ok: true,
        });
    });

    it('見えるが招待の要る部屋は invite-required、見えない部屋は無い部屋と同じ 404', async () => {
        const { rooms } = setup({
            accessType: 'invite_only',
            members: ['leader', 'm1'],
            friends: { [ALICE.id]: ['m1'] },
        });
        expect(await rooms.join(ALICE, join)).toMatchObject({
            ok: false,
            problem: { status: 403, code: 'invite-required' },
        });
        expect(await rooms.join(MALLORY, { room: ROOM_URL, clientOrigin: 'https://evil.example' })).toMatchObject({
            ok: false,
            problem: { status: 404, code: 'not-found' },
        });
        expect(await rooms.join(ALICE, { ...join, room: 'https://b.example/ap/instances/nope' })).toMatchObject({
            ok: false,
            problem: { status: 404 },
        });
    });

    it('ほかのサーバーの部屋の URL では入れない（自分の部屋だけを答える）', async () => {
        const { rooms } = setup();
        const result = await rooms.join(ALICE, { ...join, room: 'https://c.example/ap/instances/room1' });
        expect(result).toMatchObject({ ok: false, problem: { status: 404 } });
    });

    it('一度入れた来訪者は、招待が切れても部屋が続く間は入り直せる', async () => {
        const { rooms, invites } = setup({ accessType: 'invite_only' });
        invites.push({ instanceId: 'room1', inviterId: 'leader', inviteeId: ALICE.id, expiresAt: new Date(NOW + 1) });
        expect(await rooms.join(ALICE, join)).toMatchObject({ ok: true });
        invites.length = 0;
        expect(await rooms.join(ALICE, join)).toMatchObject({ ok: true });
    });

    it('満員なら断る。もう中にいる人の入り直しは通す', async () => {
        const full = setup({ maxUsers: 2, members: ['leader', 'm1'] });
        expect(await full.rooms.join(ALICE, join)).toMatchObject({ ok: false, problem: { status: 409, code: 'full' } });
        const inside = setup({ maxUsers: 2, members: ['leader', ALICE.id] });
        expect(await inside.rooms.join(ALICE, join)).toMatchObject({ ok: true });
    });

    it('新しいつながりを受けないサーバーからは、入れたことのある人だけ', async () => {
        const { rooms, admitted } = setup({ policy: { 'a.example': 'limit' } });
        expect(await rooms.join(ALICE, join)).toMatchObject({
            ok: false,
            problem: { status: 403, code: 'domain-limited' },
        });
        admitted.add(`room1|${ALICE.id}`);
        expect(await rooms.join(ALICE, join)).toMatchObject({ ok: true });
    });

    it('1 つのサーバーから同時に来られる人数を超えたら断る（部屋をまたいで数える）', async () => {
        const crowd = Array.from({ length: 20 }, (_, i) => `https://a.example/ap/users/u${i}`);
        const { rooms } = setup({ maxUsers: 100, otherRooms: { room2: crowd } });
        expect(await rooms.join(ALICE, join)).toMatchObject({ ok: false, problem: { status: 429 } });
        // ほかのサーバーの人は数えない
        expect(
            await rooms.join(visitor('bob', 'c.example'), { room: ROOM_URL, clientOrigin: 'https://c.example' }),
        ).toMatchObject({
            ok: true,
        });
    });

    it('表示名はチケットの上限に切り詰め、無ければアカウントの名前を使う', async () => {
        const { rooms, tickets } = setup();
        await rooms.join({ ...ALICE, name: `  ${'長'.repeat(40)}  ` }, join);
        await rooms.join({ ...ALICE, name: null }, join);
        expect(tickets[0]?.participant.name).toBe('長'.repeat(30));
        expect(tickets[1]?.participant.name).toBe('alice');
    });
});

describe('招待の権利（grant）', () => {
    const grant = (invitees: string[], endTime = new Date(NOW + HOUR).toISOString()) => ({
        room: ROOM_URL,
        invite: 'https://a.example/ap/activities/inv1',
        invitees,
        endTime,
    });

    it('部屋にいない人は招待できない', async () => {
        const { rooms, invites } = setup();
        const result = await rooms.grant(ALICE, grant(['https://c.example/ap/users/bob']));
        expect(result).toMatchObject({ ok: false, problem: { status: 403, code: 'not-inside' } });
        expect(invites).toHaveLength(0);
    });

    it('部屋にいる来訪者は招待でき、期限は endTime と 24 時間の短い方', async () => {
        const { rooms, invites } = setup({ members: ['leader', ALICE.id] });
        const result = await rooms.grant(
            ALICE,
            grant(['https://c.example/ap/users/bob'], new Date(NOW + 48 * HOUR).toISOString()),
        );
        expect(result).toMatchObject({ ok: true, value: { results: [{ granted: true }], room: { id: ROOM_URL } } });
        expect(invites[0]).toMatchObject({ inviterId: ALICE.id, inviteeId: 'https://c.example/ap/users/bob' });
        expect(invites[0]?.expiresAt.getTime()).toBe(NOW + 24 * HOUR);

        await rooms.grant(ALICE, grant(['https://c.example/ap/users/carol'], 'not a date'));
        expect(invites[1]?.expiresAt.getTime()).toBe(NOW + 24 * HOUR);
        await rooms.grant(ALICE, grant(['https://c.example/ap/users/dave']));
        expect(invites[2]?.expiresAt.getTime()).toBe(NOW + HOUR);
    });

    it('このサーバーのユーザーはユーザー ID で持つ（入室の確認と同じ ID）', async () => {
        const { rooms, invites } = setup({ members: ['leader', ALICE.id] });
        await rooms.grant(ALICE, grant([identity.actorUrl('u2')]));
        expect(invites[0]?.inviteeId).toBe('u2');
    });

    it('フレンドのみの部屋は、作成者のフレンドにしか招待できない', async () => {
        const { rooms, invites } = setup({
            accessType: 'friend_only',
            members: ['leader', ALICE.id],
            friends: { leader: [ALICE.id, 'https://c.example/ap/users/bob'] },
        });
        const result = await rooms.grant(
            ALICE,
            grant(['https://c.example/ap/users/bob', 'https://c.example/ap/users/carol']),
        );
        expect(result).toMatchObject({
            ok: true,
            value: {
                results: [
                    { invitee: 'https://c.example/ap/users/bob', granted: true },
                    { invitee: 'https://c.example/ap/users/carol', granted: false, reason: 'needs-leader' },
                ],
            },
        });
        expect(invites.map((i) => i.inviteeId)).toEqual(['https://c.example/ap/users/bob']);
    });

    it('読めない URL・付き合いを絞ったサーバーの人・もう中にいる人には出さない', async () => {
        const { rooms, invites } = setup({ members: ['leader', ALICE.id, 'm1'], policy: { 'evil.example': 'limit' } });
        const result = await rooms.grant(
            ALICE,
            grant(['javascript:alert(1)', 'https://evil.example/ap/users/x', identity.actorUrl('m1'), ALICE.id]),
        );
        expect(result.ok && result.value.results.map((r) => [r.granted, r.reason])).toEqual([
            [false, 'not-allowed'],
            [false, 'not-allowed'],
            [false, 'already-inside'],
            [false, 'self'],
        ]);
        expect(invites).toHaveLength(0);
    });
});

describe('見えるか（visibility）', () => {
    const ask = (member: string, viewers: string[]) => ({ room: ROOM_URL, member, viewers });

    it('中にいる人のホームだけが尋ねられる', async () => {
        const { rooms } = setup({ members: ['leader', ALICE.id] });
        expect(
            await rooms.visibility('evil.example', ask(ALICE.id, ['https://evil.example/ap/users/x'])),
        ).toMatchObject({
            ok: false,
            problem: { status: 403 },
        });
    });

    it('部屋にいない人については答えない', async () => {
        const { rooms } = setup();
        expect(await rooms.visibility('a.example', ask(ALICE.id, ['https://a.example/ap/users/bob']))).toMatchObject({
            ok: false,
            problem: { status: 409, code: 'not-inside' },
        });
    });

    it('招待のみの部屋: 中にいる人のフレンドには見えるが、入るには招待が要る', async () => {
        const { rooms } = setup({ accessType: 'invite_only', members: ['leader', ALICE.id] });
        const result = await rooms.visibility('a.example', ask(ALICE.id, ['https://a.example/ap/users/bob']));
        expect(result).toMatchObject({
            ok: true,
            value: { results: [{ viewer: 'https://a.example/ap/users/bob', visible: true, joinable: false }], ttl: 30 },
        });
    });

    it('フレンドのみの部屋: 来訪者のフレンドというだけでは見えない（作成者のフレンドだけ）', async () => {
        const { rooms } = setup({ accessType: 'friend_only', members: ['leader', ALICE.id] });
        const result = await rooms.visibility('a.example', ask(ALICE.id, ['https://a.example/ap/users/bob']));
        expect(result).toMatchObject({ ok: true, value: { results: [{ visible: false, joinable: false }] } });
    });

    it('このサーバーのユーザーについての問いは、ユーザー ID のフレンドで判定する', async () => {
        const { rooms } = setup({
            accessType: 'friend_only',
            members: ['leader', ALICE.id],
            friends: { u2: ['leader'] },
        });
        const result = await rooms.visibility('a.example', ask(ALICE.id, [identity.actorUrl('u2')]));
        expect(result).toMatchObject({ ok: true, value: { results: [{ visible: true, joinable: true }] } });
    });
});
