import { randomBytes } from 'node:crypto';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
    appConfig: { runtime: { url: 'http://svc:3002', token: 't', publicUrl: '/ws', directory: 'memory' } },
}));
vi.mock('../lib/redis', () => ({ redis: null }));

import { readRoomPresence } from './instanceRuntime';

/**
 * Go の Directory（coord.RedisDirectory.PublishPresence）が書く形の在席を、実際の Redis から読む。REDIS_URL がある時だけ走る。
 * 形を変えるときは Go の coord.RoomPresence と一緒に変える。
 */
describe.skipIf(!process.env.REDIS_URL)('readRoomPresence (Redis統合)', () => {
    const client = createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined });
    const prefix = `ubi:test:presence:${randomBytes(8).toString('hex')}:`;

    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        const keys = await client.keys(`${prefix}*`);
        if (keys.length > 0) await client.del(keys);
        await client.close();
    });

    it('Go が書いた在席を読み、期限の切れた部屋は居ないものとする', async () => {
        await client.sAdd(`${prefix}rooms`, ['busy', 'empty', 'expired']);
        await client.set(`${prefix}presence:busy`, JSON.stringify({ members: ['alice', 'bob'], emptySince: 0 }), {
            expiration: { type: 'PX', value: 15_000 },
        });
        await client.set(`${prefix}presence:empty`, JSON.stringify({ members: [], emptySince: 1700 }), {
            expiration: { type: 'PX', value: 15_000 },
        });
        const presence = await readRoomPresence(client, prefix);
        expect(Object.fromEntries(presence)).toEqual({
            busy: { id: 'busy', memberIds: ['alice', 'bob'], emptySince: 0 },
            empty: { id: 'empty', memberIds: [], emptySince: 1700 },
        });
    });
});
