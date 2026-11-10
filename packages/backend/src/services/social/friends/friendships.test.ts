import type { FriendRow, RemoteActorRecord } from '@ubichill/db';
import { type BlockEdge, interactionRefusal } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFriendshipService } from './friendships';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const ACTOR = 'https://b.example/users/bob';
const row = (userId: string, friendId: string, status: 'pending' | 'accepted'): FriendRow =>
    ({ userId, friendId, status, createdAt: new Date('2026-11-10T00:00:00Z') }) as FriendRow;

function setup(options: { blocks?: BlockEdge[]; rows?: FriendRow[]; federation?: boolean } = {}) {
    const rows: FriendRow[] = [...(options.rows ?? [])];
    const notified: string[] = [];
    const writes: string[] = [];
    const service = createFriendshipService({
        relations: {
            interaction: async (from, to) =>
                from === to ? 'self' : interactionRefusal(from, to, options.blocks ?? []),
        },
        people: {
            findRemotePerson: async (ref) => (ref === ACTOR ? ({ id: ACTOR } as RemoteActorRecord) : null),
        },
        local: {
            findUser: async (id) => (['alice', 'bob', 'carol', SYSTEM].includes(id) ? { id } : undefined),
            listForUser: async () => rows,
            requestOrAccept: async (from, to) => {
                writes.push(`request:${from}->${to}`);
                const incoming = rows.find((r) => r.userId === to && r.friendId === from);
                if (incoming) incoming.status = 'accepted';
                else rows.push(row(from, to, 'pending'));
                return rows;
            },
            accept: async (me, from) => {
                writes.push(`accept:${from}->${me}`);
                return rows.some((r) => r.userId === from && r.friendId === me);
            },
            remove: async () => true,
        },
        remote: {
            federation:
                options.federation === false
                    ? null
                    : {
                          request: async () => ({ ok: false, reason: 'unsupported' }),
                          accept: async () => true,
                          remove: async () => true,
                      },
            actorOf: async () => null,
            listForUser: async () => [],
            removeRecord: async () => false,
        },
        summariesOf: async (ids) => ids.map((id) => ({ id, name: id, handle: id, image: null, bio: null })),
        systemUserId: SYSTEM,
        notify: {
            followRequested: async (from, to) => notified.push(`requested:${from}->${to}`),
            friendAccepted: async (from, to) => notified.push(`accepted:${from}->${to}`),
            friendshipRemoved: async (from, to) => notified.push(`removed:${from}->${to}`),
        },
        background: (task) => void task,
    });
    return { service, notified, writes };
}

describe('フレンドの申請', () => {
    it('申請すると outgoing、相手からの申請があれば承認になる', async () => {
        const { service, notified } = setup({ rows: [row('carol', 'alice', 'pending')] });
        expect(await service.request('alice', 'bob')).toEqual({ ok: true, friendship: 'outgoing' });
        expect(await service.request('alice', 'carol')).toEqual({ ok: true, friendship: 'friends' });
        expect(notified).toEqual(['requested:alice->bob', 'accepted:alice->carol']);
    });

    it('自分がブロックしている相手には、解除を促す（このサーバーの人もほかのサーバーの人も）', async () => {
        const { service, writes } = setup({
            blocks: [
                { blockerId: 'alice', blockedId: 'bob' },
                { blockerId: 'alice', blockedId: ACTOR },
            ],
        });
        expect(await service.request('alice', 'bob')).toEqual({ ok: false, reason: 'blocking' });
        expect(await service.request('alice', ACTOR)).toEqual({ ok: false, reason: 'blocking' });
        expect(writes).toEqual([]);
    });

    it('相手にブロックされていたら、送れたように見せて何も書かず知らせない', async () => {
        const { service, writes, notified } = setup({ blocks: [{ blockerId: 'bob', blockedId: 'alice' }] });
        expect(await service.request('alice', 'bob')).toEqual({ ok: true, friendship: 'outgoing' });
        expect(writes).toEqual([]);
        expect(notified).toEqual([]);
    });

    it('お互いにブロックしていれば、自分のブロックを明かす（送れたようには見せない）', async () => {
        const { service } = setup({
            blocks: [
                { blockerId: 'bob', blockedId: 'alice' },
                { blockerId: 'alice', blockedId: 'bob' },
            ],
        });
        expect(await service.request('alice', 'bob')).toEqual({ ok: false, reason: 'blocking' });
    });

    it('自分・居ない人・システムユーザー・空の ID は断る', async () => {
        const { service } = setup();
        expect(await service.request('alice', 'alice')).toEqual({ ok: false, reason: 'self' });
        expect(await service.request('alice', 'ghost')).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.request('alice', SYSTEM)).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.request('alice', '')).toEqual({ ok: false, reason: 'not-found' });
    });

    it('ほかのサーバーの人: 連合の答えをそのまま返し、連合が無ければ引けない', async () => {
        expect(await setup().service.request('alice', ACTOR)).toEqual({ ok: false, reason: 'unsupported' });
        expect(await setup({ federation: false }).service.request('alice', ACTOR)).toEqual({
            ok: false,
            reason: 'remote-unavailable',
        });
        expect(await setup().service.request('alice', 'https://b.example/users/ghost')).toEqual({
            ok: false,
            reason: 'remote-unavailable',
        });
    });
});

describe('フレンドの承認', () => {
    it('どちらの向きのブロックでも、申請が無いのと同じに答えて承認しない', async () => {
        const rows = [row('bob', 'alice', 'pending')];
        for (const blocks of [[{ blockerId: 'alice', blockedId: 'bob' }], [{ blockerId: 'bob', blockedId: 'alice' }]]) {
            const { service, writes } = setup({ rows, blocks });
            expect(await service.accept('alice', 'bob')).toEqual({ ok: false, reason: 'no-request' });
            expect(writes).toEqual([]);
        }
    });

    it('申請があれば承認して知らせる', async () => {
        const { service, notified } = setup({ rows: [row('bob', 'alice', 'pending')] });
        expect(await service.accept('alice', 'bob')).toEqual({ ok: true });
        expect(notified).toEqual(['accepted:alice->bob']);
    });
});

describe('フレンドの解除', () => {
    it('ほかのサーバーの人の文書が引けなくても、こちらの記録を消す（無ければ false）', async () => {
        const { service } = setup();
        expect(await service.remove('alice', ACTOR)).toBe(false);
    });

    it('このサーバーの人は消したら知らせる', async () => {
        const { service, notified } = setup();
        expect(await service.remove('alice', 'bob')).toBe(true);
        expect(notified).toEqual(['removed:alice->bob']);
    });
});
