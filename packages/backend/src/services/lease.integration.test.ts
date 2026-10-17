import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, describe } from 'vitest';
import { createRedisLease } from './lease';
import { leaseContract } from './leaseContract';

/**
 * Redis 実装のリースの統合テスト。REDIS_URL がある時だけ走る。ローカル実行例:
 *   docker run -d --rm --name ubichill-redis-test -p 127.0.0.1:6390:6379 redis:7-alpine
 *   REDIS_URL=redis://127.0.0.1:6390 pnpm exec vitest run packages/backend/src/services/lease
 */
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('createRedisLease (Redis統合)', () => {
    const client = createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined });
    const prefix = `ubi:test:lease:${randomBytes(8).toString('hex')}:`;
    const counter = { next: 0 };

    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        const keys = await client.keys(`${prefix}*`);
        if (keys.length > 0) await client.del(keys);
        await client.close();
    });

    leaseContract(() => {
        counter.next += 1;
        return {
            lease: createRedisLease(client, `${prefix}${counter.next}:`),
            advance: async (ms) => {
                await sleep(ms);
            },
        };
    });
});
