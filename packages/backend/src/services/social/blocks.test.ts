import { BLOCK_LIMITS, type BlockEdge } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createBlockService } from './blocks';

function setup(options: { edges?: BlockEdge[]; failSever?: boolean; count?: number } = {}) {
    const edges: BlockEdge[] = [...(options.edges ?? [])];
    const severed: Array<[string, string]> = [];
    const service = createBlockService({
        store: {
            add: async (blockerId, blockedId) => {
                if (edges.some((e) => e.blockerId === blockerId && e.blockedId === blockedId)) return false;
                edges.push({ blockerId, blockedId });
                return true;
            },
            remove: async (blockerId, blockedId) => {
                const at = edges.findIndex((e) => e.blockerId === blockerId && e.blockedId === blockedId);
                if (at < 0) return false;
                edges.splice(at, 1);
                return true;
            },
            countForUser: async (blockerId) => options.count ?? edges.filter((e) => e.blockerId === blockerId).length,
            findBetween: async (a, b) =>
                edges.filter(
                    (e) => (e.blockerId === a && e.blockedId === b) || (e.blockerId === b && e.blockedId === a),
                ),
        },
        sever: async (blockerId, blockedId) => {
            severed.push([blockerId, blockedId]);
            if (options.failSever) throw new Error('関係を消せない');
        },
        now: () => new Date('2026-11-10T00:00:00Z'),
    });
    return { service, edges, severed };
}

describe('ブロックする', () => {
    it('ブロックの行を書き、2 人の関係を消す', async () => {
        const { service, edges, severed } = setup();
        expect(await service.block('alice', 'bob')).toEqual({ ok: true, created: true });
        expect(edges).toEqual([{ blockerId: 'alice', blockedId: 'bob' }]);
        expect(severed).toEqual([['alice', 'bob']]);
    });

    it('ブロックし直しても行は 1 つ。関係は消し直す（前回の途中の失敗を埋め合わせる）', async () => {
        const { service, edges, severed } = setup();
        await service.block('alice', 'bob');
        expect(await service.block('alice', 'bob')).toEqual({ ok: true, created: false });
        expect(edges).toHaveLength(1);
        expect(severed).toHaveLength(2);
    });

    it('相手にブロックされていても、こちらからもブロックできる（行は向きごと）', async () => {
        const { service, edges } = setup({ edges: [{ blockerId: 'bob', blockedId: 'alice' }] });
        expect(await service.block('alice', 'bob')).toEqual({ ok: true, created: true });
        expect(edges).toHaveLength(2);
    });

    it('自分はブロックできない（関係も消さない）', async () => {
        const { service, edges, severed } = setup();
        expect(await service.block('alice', 'alice')).toEqual({ ok: false, reason: 'self' });
        expect(edges).toEqual([]);
        expect(severed).toEqual([]);
    });

    it('上限に達したら新しい相手は断る。ブロック済みの相手のブロックし直しは通す', async () => {
        const { service } = setup({
            count: BLOCK_LIMITS.MAX_BLOCKS,
            edges: [{ blockerId: 'alice', blockedId: 'bob' }],
        });
        expect(await service.block('alice', 'carol')).toEqual({ ok: false, reason: 'limit' });
        expect(await service.block('alice', 'bob')).toEqual({ ok: true, created: false });
    });

    it('相手からのブロックは、こちらの上限の数に入らない', async () => {
        const { service } = setup({ edges: [{ blockerId: 'bob', blockedId: 'alice' }] });
        expect(await service.block('alice', 'carol')).toMatchObject({ ok: true });
    });

    it('関係を消す途中で失敗しても、ブロックの行は残る（相手からの申請はもう止まる）', async () => {
        const { service, edges } = setup({ failSever: true });
        await expect(service.block('alice', 'bob')).rejects.toThrow();
        expect(edges).toEqual([{ blockerId: 'alice', blockedId: 'bob' }]);
    });

    it('ほかのサーバーの人（actor の URL）もブロックできる', async () => {
        const actor = 'https://c.example/ap/users/bob';
        const { service, edges } = setup();
        expect(await service.block('alice', actor)).toMatchObject({ ok: true });
        expect(edges).toEqual([{ blockerId: 'alice', blockedId: actor }]);
    });
});

describe('ブロックを解除する', () => {
    it('自分のブロックだけを解除する（相手からのブロックは残る）', async () => {
        const { service, edges } = setup({
            edges: [
                { blockerId: 'alice', blockedId: 'bob' },
                { blockerId: 'bob', blockedId: 'alice' },
            ],
        });
        expect(await service.unblock('alice', 'bob')).toBe(true);
        expect(edges).toEqual([{ blockerId: 'bob', blockedId: 'alice' }]);
        expect(await service.unblock('alice', 'bob')).toBe(false);
    });
});
