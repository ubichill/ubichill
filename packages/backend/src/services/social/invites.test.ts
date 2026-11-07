import { type AccessType, INVITE_LIMITS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createInviteService, type InviteRoom, type InviteServiceDeps } from './invites';

const START = new Date('2026-11-07T00:00:00.000Z');

/** DB・在室・通知のメモリの偽物。フレンドは双方向の組で持つ。 */
function setup(options: {
    friends?: Array<[string, string]>;
    rooms?: Array<InviteRoom & { members: string[] }>;
    /** 連合: 来訪中のほかのサーバーの部屋（ユーザー → 住所） */
    visiting?: Record<string, string>;
    /** 連合: ほかのサーバーの人へ届けられるか */
    deliverable?: boolean;
}) {
    const clock = { now: START };
    const rooms = new Map((options.rooms ?? []).map((r) => [r.id, r]));
    const pairs = options.friends ?? [];
    const invites: Array<{
        instanceId: string;
        inviterId: string;
        inviteeId: string;
        message: string | null;
        expiresAt: Date;
    }> = [];
    const requests: Array<{ requesterId: string; targetId: string; expiresAt: Date }> = [];
    const sent: Array<{ kind: string; to: string; from: string; detail?: unknown }> = [];
    const deps: InviteServiceDeps = {
        rooms: {
            find: async (id) => rooms.get(id),
            describe: async (id) => (rooms.has(id) ? { name: `world of ${id}`, image: null } : undefined),
        },
        presence: async () => new Map([...rooms.values()].map((r) => [r.id, { memberIds: r.members }])),
        friendIdsOf: async (userId) =>
            new Set(pairs.flatMap(([a, b]) => (a === userId ? [b] : b === userId ? [a] : []))),
        invites: {
            upsert: async (input) => {
                const at = invites.findIndex(
                    (i) => i.instanceId === input.instanceId && i.inviteeId === input.inviteeId,
                );
                if (at >= 0) invites.splice(at, 1);
                invites.push(input);
            },
            findValid: async (instanceId, inviteeId, now) =>
                invites.find((i) => i.instanceId === instanceId && i.inviteeId === inviteeId && i.expiresAt > now),
            createRequest: async (input, now) => {
                const existing = requests.find(
                    (r) => r.requesterId === input.requesterId && r.targetId === input.targetId,
                );
                if (existing && existing.expiresAt > now) return 'exists';
                if (existing) requests.splice(requests.indexOf(existing), 1);
                requests.push(input);
                return 'created';
            },
            hasRequest: async (requesterId, targetId, now) =>
                requests.some((r) => r.requesterId === requesterId && r.targetId === targetId && r.expiresAt > now),
            removeRequest: async (requesterId, targetId) => {
                const at = requests.findIndex((r) => r.requesterId === requesterId && r.targetId === targetId);
                if (at < 0) return false;
                requests.splice(at, 1);
                return true;
            },
        },
        notify: {
            invited: async (input) =>
                void sent.push({ kind: 'invite', to: input.inviteeId, from: input.inviterId, detail: input }),
            inviteRequested: async (input) =>
                void sent.push({ kind: 'request', to: input.targetId, from: input.requesterId }),
            inviteRequestAnswered: async (targetId, requesterId) =>
                void sent.push({ kind: 'answered', to: targetId, from: requesterId }),
        },
        federation: {
            isRemoteRoom: (ref) => ref.includes('@'),
            visitingRoom: async (userId) => options.visiting?.[userId],
            deliverInvite: async (input) => {
                if (options.deliverable === false) return false;
                sent.push({ kind: 'deliver', to: input.inviteeId, from: input.inviterId, detail: input });
                return true;
            },
            sendFromRemoteRoom: async (inviterId, roomAddress, inviteeIds) => {
                if (options.visiting?.[inviterId] !== roomAddress) return null;
                sent.push({ kind: 'remote-room', to: inviteeIds.join(','), from: inviterId, detail: roomAddress });
                return inviteeIds.map((userId) => ({ userId, ok: true }));
            },
            requestRemote: async (requesterId, targetId) => {
                sent.push({ kind: 'remote-request', to: targetId, from: requesterId });
                return { ok: true, alreadyRequested: false };
            },
        },
        now: () => clock.now,
    };
    const tick = (ms: number) => {
        clock.now = new Date(clock.now.getTime() + ms);
    };
    return { service: createInviteService(deps), invites, requests, sent, tick, rooms };
}

const room = (id: string, accessType: AccessType, leaderId: string, members: string[]) => ({
    id,
    accessType,
    leaderId,
    members,
});

describe('招待を送る', () => {
    it('作成者はフレンドを招待でき、24 時間有効な招待と通知ができる', async () => {
        const { service, invites, sent } = setup({
            friends: [['leader', 'bob']],
            rooms: [room('r1', 'invite_only', 'leader', ['leader'])],
        });
        const result = await service.sendInvites('leader', 'r1', ['bob'], 'おいで');
        expect(result).toEqual({ ok: true, results: [{ userId: 'bob', ok: true }] });
        expect(invites[0]).toMatchObject({ instanceId: 'r1', inviteeId: 'bob', message: 'おいで' });
        expect(invites[0]?.expiresAt.getTime()).toBe(START.getTime() + INVITE_LIMITS.INVITE_TTL_MS);
        expect(sent).toEqual([expect.objectContaining({ kind: 'invite', to: 'bob', from: 'leader' })]);
    });

    it('送れない相手には理由を返し、ほかの相手には送る（1 人の失敗で全体を止めない）', async () => {
        const { service, sent } = setup({
            friends: [
                ['m1', 'bob'],
                ['m1', 'carol'],
                ['leader', 'carol'],
            ],
            rooms: [room('r1', 'invite_only', 'leader', ['leader', 'm1'])],
        });
        const result = await service.sendInvites('m1', 'r1', ['bob', 'carol', 'stranger'], null);
        expect(result).toEqual({
            ok: true,
            results: [
                { userId: 'bob', ok: false, reason: 'needs-leader' },
                { userId: 'carol', ok: true },
                { userId: 'stranger', ok: false, reason: 'not-friend' },
            ],
        });
        expect(sent.map((s) => s.to)).toEqual(['carol']);
    });

    it('部屋にいない人は、部屋の ID を知っていても送れない', async () => {
        const { service, sent } = setup({
            friends: [['outsider', 'bob']],
            rooms: [room('r1', 'public', 'leader', ['leader'])],
        });
        expect(await service.sendInvites('outsider', 'r1', ['bob'], null)).toEqual({
            ok: true,
            results: [{ userId: 'bob', ok: false, reason: 'not-inside' }],
        });
        expect(sent).toEqual([]);
    });

    it('同じ人を 2 回並べても 1 回だけ送る。一言が空なら一言なし', async () => {
        const { service, sent, invites } = setup({
            friends: [['leader', 'bob']],
            rooms: [room('r1', 'public', 'leader', ['leader'])],
        });
        await service.sendInvites('leader', 'r1', ['bob', 'bob'], '');
        expect(sent).toHaveLength(1);
        expect(invites[0]?.message).toBeNull();
    });

    it('部屋が無ければ not-found（何も保存しない）', async () => {
        const { service, invites } = setup({ friends: [['leader', 'bob']] });
        expect(await service.sendInvites('leader', 'gone', ['bob'], null)).toEqual({ ok: false, error: 'not-found' });
        expect(invites).toEqual([]);
    });

    it('招待の画面には、送れるかとどこかにいるかを付けてフレンドを出す', async () => {
        const { service } = setup({
            friends: [
                ['m1', 'bob'],
                ['m1', 'carol'],
                ['leader', 'carol'],
            ],
            rooms: [room('r1', 'friend_only', 'leader', ['leader', 'm1']), room('r2', 'public', 'carol', ['carol'])],
        });
        const candidates = await service.candidates('m1', 'r1');
        expect(candidates).toEqual(
            expect.arrayContaining([
                { userId: 'bob', refusal: 'needs-leader', online: false },
                { userId: 'carol', refusal: null, online: true },
            ]),
        );
    });
});

describe('招待で入れるか', () => {
    it('期限内だけ招待として効く', async () => {
        const { service, tick } = setup({
            friends: [['leader', 'bob']],
            rooms: [room('r1', 'invite_only', 'leader', ['leader'])],
        });
        await service.sendInvites('leader', 'r1', ['bob'], null);
        expect(await service.isInvited('r1', 'bob')).toBe(true);
        expect(await service.isInvited('r1', 'carol')).toBe(false);
        tick(INVITE_LIMITS.INVITE_TTL_MS);
        expect(await service.isInvited('r1', 'bob')).toBe(false);
    });
});

describe('リクエストインバイト', () => {
    const scene = () =>
        setup({
            friends: [
                ['me', 'friend'],
                ['friend', 'leader'],
            ],
            rooms: [room('r1', 'invite_only', 'leader', ['leader', 'friend'])],
        });

    it('招待が要る部屋にいるフレンドに頼むと、相手に届く。期限内に頼み直しても 2 回は届かない', async () => {
        const { service, sent, tick } = scene();
        expect(await service.requestInvite('me', 'friend')).toEqual({ ok: true, alreadyRequested: false });
        tick(1000);
        expect(await service.requestInvite('me', 'friend')).toEqual({ ok: true, alreadyRequested: true });
        expect(sent.filter((s) => s.kind === 'request')).toHaveLength(1);
        // 期限が過ぎれば頼み直せる
        tick(INVITE_LIMITS.REQUEST_TTL_MS);
        expect(await service.requestInvite('me', 'friend')).toEqual({ ok: true, alreadyRequested: false });
    });

    it('そのまま入れる部屋・招待をもらっている部屋なら頼まない', async () => {
        const open = setup({ friends: [['me', 'friend']], rooms: [room('r1', 'public', 'friend', ['friend'])] });
        expect(await open.service.requestInvite('me', 'friend')).toEqual({ ok: false, reason: 'can-join' });

        const invited = scene();
        await invited.service.sendInvites('friend', 'r1', ['me'], null);
        // friend は作成者ではなく、me は作成者のフレンドではない → 招待は送れていない
        expect(await invited.service.isInvited('r1', 'me')).toBe(false);
        const byLeader = setup({
            friends: [
                ['me', 'friend'],
                ['me', 'leader'],
            ],
            rooms: [room('r1', 'invite_only', 'leader', ['leader', 'friend'])],
        });
        await byLeader.service.sendInvites('leader', 'r1', ['me'], null);
        expect(await byLeader.service.requestInvite('me', 'friend')).toEqual({ ok: false, reason: 'can-join' });
    });

    it('部屋にいないフレンド・フレンドでない人には頼めない', async () => {
        const { service } = setup({ friends: [['me', 'friend']], rooms: [room('r1', 'invite_only', 'x', ['x', 'y'])] });
        expect(await service.requestInvite('me', 'friend')).toEqual({ ok: false, reason: 'offline' });
        expect(await service.requestInvite('me', 'y')).toEqual({ ok: false, reason: 'not-friend' });
    });

    it('頼まれた人が招待すると、頼んだ人に招待が届き、リクエストは片付く', async () => {
        const { service, sent, requests } = setup({
            friends: [['me', 'leader']],
            rooms: [room('r1', 'invite_only', 'leader', ['leader'])],
        });
        await service.requestInvite('me', 'leader');
        expect(await service.answerRequest('leader', 'me', true)).toEqual({ ok: true });
        expect(await service.isInvited('r1', 'me')).toBe(true);
        expect(requests).toEqual([]);
        expect(sent.map((s) => s.kind)).toEqual(['request', 'invite', 'answered']);
    });

    it('頼まれた人が送れない（作成者でなく、頼んだ人が作成者のフレンドでない）なら理由を返し、リクエストは残す', async () => {
        const { service, requests } = scene();
        await service.requestInvite('me', 'friend');
        expect(await service.answerRequest('friend', 'me', true)).toEqual({ ok: false, reason: 'needs-leader' });
        expect(requests).toHaveLength(1);
    });

    it('頼まれた人が部屋を出ていたら offline（リクエストは残す）', async () => {
        const { service, rooms, requests } = scene();
        await service.requestInvite('me', 'friend');
        rooms.delete('r1');
        expect(await service.answerRequest('friend', 'me', true)).toEqual({ ok: false, reason: 'offline' });
        expect(requests).toHaveLength(1);
    });

    it('断ると片付けるだけで、頼んだ人には何も届かない', async () => {
        const { service, sent, requests } = scene();
        await service.requestInvite('me', 'friend');
        expect(await service.answerRequest('friend', 'me', false)).toEqual({ ok: true });
        expect(requests).toEqual([]);
        expect(sent.filter((s) => s.to === 'me')).toEqual([]);
    });

    it('期限の過ぎた・無いリクエストには答えられず、残った通知も片付ける', async () => {
        const { service, sent, tick } = scene();
        await service.requestInvite('me', 'friend');
        tick(INVITE_LIMITS.REQUEST_TTL_MS);
        expect(await service.answerRequest('friend', 'me', true)).toEqual({ ok: false, reason: 'no-request' });
        expect(sent.at(-1)).toEqual({ kind: 'answered', to: 'friend', from: 'me' });
        expect(await service.answerRequest('friend', 'nobody', false)).toEqual({ ok: false, reason: 'no-request' });
    });
});

describe('連合（ほかのサーバーの人・部屋）', () => {
    const BOB = 'https://b.example/ap/users/bob';

    it('このサーバーの部屋へ、ほかのサーバーのフレンドを招待する: 権利はここに作り、知らせは相手のサーバーへ', async () => {
        const { service, invites, sent } = setup({
            friends: [['leader', BOB]],
            rooms: [room('r1', 'invite_only', 'leader', ['leader'])],
        });
        expect(await service.sendInvites('leader', 'r1', [BOB], null)).toEqual({
            ok: true,
            results: [{ userId: BOB, ok: true }],
        });
        expect(invites[0]).toMatchObject({ instanceId: 'r1', inviteeId: BOB });
        expect(sent).toEqual([expect.objectContaining({ kind: 'deliver', to: BOB })]);
    });

    it('相手のサーバーへ届けられなければ unavailable', async () => {
        const { service } = setup({
            friends: [['leader', BOB]],
            rooms: [room('r1', 'public', 'leader', ['leader'])],
            deliverable: false,
        });
        expect(await service.sendInvites('leader', 'r1', [BOB], null)).toEqual({
            ok: true,
            results: [{ userId: BOB, ok: false, reason: 'unavailable' }],
        });
    });

    it('フレンドでないほかのサーバーの人には送らない（届ける前に断る）', async () => {
        const { service, sent } = setup({ rooms: [room('r1', 'public', 'leader', ['leader'])] });
        expect(await service.sendInvites('leader', 'r1', [BOB], null)).toEqual({
            ok: true,
            results: [{ userId: BOB, ok: false, reason: 'not-friend' }],
        });
        expect(sent).toEqual([]);
    });

    it('来訪中のほかのサーバーの部屋（住所）からの招待は、部屋のサーバーに任せる。別の部屋の住所なら not-found', async () => {
        const { service, sent } = setup({ friends: [['alice', 'bob']], visiting: { alice: 'r9@b.example' } });
        expect(await service.sendInvites('alice', 'r9@b.example', ['bob'], null)).toEqual({
            ok: true,
            results: [{ userId: 'bob', ok: true }],
        });
        expect(await service.sendInvites('alice', 'r8@b.example', ['bob'], null)).toEqual({
            ok: false,
            error: 'not-found',
        });
        expect(sent.map((s) => s.kind)).toEqual(['remote-room']);
    });

    it('招待の候補: 来訪中の部屋ならフレンド全員（規則は部屋のサーバーが確かめる）、ほかの部屋なら undefined', async () => {
        const { service } = setup({
            friends: [
                ['alice', 'bob'],
                ['alice', BOB],
            ],
            visiting: { alice: 'r9@b.example' },
        });
        expect((await service.candidates('alice', 'r9@b.example'))?.map((c) => [c.userId, c.refusal])).toEqual([
            ['bob', null],
            [BOB, null],
        ]);
        expect(await service.candidates('alice', 'r8@b.example')).toBeUndefined();
    });

    it('ほかのサーバーのフレンドへのリクエストは、相手のサーバーへ送る', async () => {
        const { service, sent } = setup({ friends: [['alice', BOB]] });
        expect(await service.requestInvite('alice', BOB)).toEqual({ ok: true, alreadyRequested: false });
        expect(sent).toEqual([{ kind: 'remote-request', to: BOB, from: 'alice' }]);
    });

    it('ほかのサーバーの部屋に来訪中のフレンドにも頼め、答えるとその部屋へ招待する', async () => {
        const { service, sent } = setup({ friends: [['alice', 'bob']], visiting: { bob: 'r9@b.example' } });
        expect(await service.requestInvite('alice', 'bob')).toEqual({ ok: true, alreadyRequested: false });
        expect(await service.answerRequest('bob', 'alice', true)).toEqual({ ok: true });
        expect(sent.map((s) => [s.kind, s.to, s.from])).toEqual([
            ['request', 'bob', 'alice'],
            ['remote-room', 'alice', 'bob'],
            ['answered', 'bob', 'alice'],
        ]);
    });

    it('どこにもいなければ、リクエストは offline で断る', async () => {
        const { service } = setup({ friends: [['alice', 'bob']] });
        expect(await service.requestInvite('alice', 'bob')).toEqual({ ok: false, reason: 'offline' });
    });
});
