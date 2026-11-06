import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, describe } from 'vitest';
import { createRedisAbsenceClock } from './absenceClock';
import { absenceClockContract, CONTRACT_ABSENCE_TTL_MS } from './absenceClockContract';

/** Redis 実装の不在の起点の統合テスト。REDIS_URL がある時だけ走る（実行例は lease.integration.test.ts）。 */
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('createRedisAbsenceClock (Redis統合)', () => {
    const client = createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined });
    const prefix = `ubi:test:absent:${randomBytes(8).toString('hex')}:`;
    const counter = { next: 0 };

    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        const keys = await client.keys(`${prefix}*`);
        if (keys.length > 0) await client.del(keys);
        await client.close();
    });

    absenceClockContract(() => {
        counter.next += 1;
        return {
            clock: createRedisAbsenceClock(client, CONTRACT_ABSENCE_TTL_MS, `${prefix}${counter.next}:`),
            advance: async (ms) => {
                await sleep(ms);
            },
        };
    });
});
