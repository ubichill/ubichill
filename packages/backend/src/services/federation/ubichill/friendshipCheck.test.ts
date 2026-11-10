import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from '../identity';
import type { FederationResponse } from '../transport/transport';
import { createFriendshipCheck } from './friendshipCheck';

const identity = createFederationIdentity('https://a.example');
const ALICE = identity.actorUrl('alice');
const BOB = 'https://b.example/ap/users/bob';
const DAVE = 'https://d.example/ap/users/dave';
const CAROL = 'https://b.example/ap/users/carol';
const ROOM_ON_C = 'https://c.example/ap/instances/r1';

const response = (status: number, json?: unknown): FederationResponse => ({
    status,
    contentType: 'application/json',
    json,
    retryAfter: null,
});

function setup(options: { visits?: Record<string, string>; reply?: (body: unknown) => FederationResponse } = {}) {
    const clock = { now: Date.parse('2026-11-07T00:00:00Z') };
    const calls: Array<{ url: string; body: unknown; signAs: unknown }> = [];
    const check = createFriendshipCheck({
        identity,
        transport: {
            post: async (url, body, o) => {
                calls.push({ url, body, signAs: o.signAs });
                return options.reply?.(body) ?? response(503);
            },
        },
        policyOf: (domain) => (domain === 'evil.example' ? 'block' : 'allow'),
        stateOf: async (userId, actorId) =>
            userId === 'alice' && (actorId === BOB || actorId === DAVE)
                ? 'friends'
                : userId === 'alice' && actorId === CAROL
                  ? 'incoming'
                  : 'none',
        visitOf: async (userId) => {
            const roomUrl = options.visits?.[userId];
            return roomUrl ? { roomUrl } : undefined;
        },
        now: () => clock.now,
    });
    return { check, calls, clock };
}

describe('答える（user のホームとして）', () => {
    it('other のホームには、そのサーバーの人との関係を向き（申請中など）まで答える（届かなかった知らせの埋め合わせ）', async () => {
        const { check } = setup();
        expect(await check.answer('b.example', { user: ALICE, other: BOB })).toEqual({
            ok: true,
            value: { friends: true, state: 'friends' },
        });
        expect(await check.answer('b.example', { user: ALICE, other: CAROL })).toEqual({
            ok: true,
            value: { friends: false, state: 'incoming' },
        });
    });

    it('user が来訪中の部屋のサーバーには、ほかのサーバーの人との関係も答える', async () => {
        const { check } = setup({ visits: { alice: ROOM_ON_C } });
        expect(await check.answer('c.example', { user: ALICE, other: DAVE })).toEqual({
            ok: true,
            value: { friends: true },
        });
    });

    it('来訪していない・ほかの部屋に来訪中なら、第三者との関係は答えない（付き合いを探らせない）', async () => {
        expect(await setup().check.answer('c.example', { user: ALICE, other: DAVE })).toMatchObject({
            ok: false,
            problem: { status: 403 },
        });
        const elsewhere = setup({ visits: { alice: 'https://e.example/ap/instances/r9' } });
        expect(await elsewhere.check.answer('c.example', { user: ALICE, other: DAVE })).toMatchObject({ ok: false });
    });

    it('このサーバーの人でない user については答えない', async () => {
        const { check } = setup();
        expect(await check.answer('b.example', { user: 'https://x.example/ap/users/x', other: BOB })).toMatchObject({
            ok: false,
        });
    });
});

describe('尋ねる（部屋のサーバーとして）', () => {
    it('member のホームへ Application の署名で尋ね、答えを 30 秒使い回す', async () => {
        const { check, calls, clock } = setup({ reply: () => response(200, { friends: true }) });
        expect(await check.ask(BOB, DAVE)).toBe(true);
        expect(await check.ask(BOB, DAVE)).toBe(true);
        expect(calls).toEqual([
            {
                url: 'https://b.example/federation/v1/friendships/check',
                body: { user: BOB, other: DAVE },
                signAs: { kind: 'app' },
            },
        ]);
        clock.now += 30_001;
        await check.ask(BOB, DAVE);
        expect(calls).toHaveLength(2);
    });

    it('答えられない・読めない答え・失敗はフレンドでないとみなす', async () => {
        expect(await setup({ reply: () => response(403) }).check.ask(BOB, DAVE)).toBe(false);
        expect(await setup({ reply: () => response(200, { friends: 'yes' }) }).check.ask(BOB, DAVE)).toBe(false);
        expect(await setup().check.ask(BOB, DAVE)).toBe(false);
    });

    it('連合しないサーバー・このサーバーの人には尋ねない', async () => {
        const { check, calls } = setup({ reply: () => response(200, { friends: true }) });
        expect(await check.ask('https://evil.example/ap/users/m', DAVE)).toBe(false);
        expect(await check.ask(ALICE, DAVE)).toBe(false);
        expect(calls).toEqual([]);
    });
});
