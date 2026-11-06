import { randomBytes } from 'node:crypto';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placementOrder, readPlacement } from './instancePlacement';

/**
 * Go の Directory（coord.RedisDirectory の Heartbeat・Assign）が書く形のノードと割り当てを、実際の Redis から読む。
 * REDIS_URL がある時だけ走る。形を変えるときは Go の coord.NodeInfo と一緒に変える。
 */
describe.skipIf(!process.env.REDIS_URL)('readPlacement (Redis統合)', () => {
    const client = createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined });
    const prefix = `ubi:test:placement:${randomBytes(8).toString('hex')}:`;
    const node = (addr: string, load: object) =>
        JSON.stringify({ addr, startedAt: 1, state: 'ready', rooms: 0, connections: 0, capacity: 10, ...load });

    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        const keys = await client.keys(`${prefix}*`);
        if (keys.length > 0) await client.del(keys);
        await client.close();
    });

    it('生きている Pod を空いている順に並べ、期限の切れた Pod を一覧から外す', async () => {
        await client.sAdd(`${prefix}nodes`, ['busy', 'idle', 'draining', 'gone']);
        const ttl = { expiration: { type: 'PX', value: 15_000 } } as const;
        await client.set(`${prefix}node:busy`, node('10.0.0.1:3002', { connections: 30 }), ttl);
        await client.set(`${prefix}node:idle`, node('10.0.0.2:3002', { connections: 1 }), ttl);
        await client.set(`${prefix}node:draining`, node('10.0.0.3:3002', { state: 'draining' }), ttl);
        await client.hSet(`${prefix}room:room`, { node: 'busy', epoch: '3', token: 't', gen: 'g' });

        const view = await readPlacement(client, 'room', prefix);
        expect(view.owner).toBe('busy');
        expect(placementOrder(view.nodes, view.owner).map((n) => n.id)).toEqual(['busy', 'idle']);
        expect(placementOrder(view.nodes).map((n) => n.id)).toEqual(['idle', 'busy']);
        expect((await client.sMembers(`${prefix}nodes`)).sort()).toEqual(['busy', 'draining', 'idle']);
    });
});
