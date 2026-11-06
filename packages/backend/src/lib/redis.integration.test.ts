import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ appConfig: { redis: { url: undefined, password: undefined } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { connectRedis, redisHealth } from './redis';

/** REDIS_URL（と REDIS_PASSWORD）がある時だけ走る。実行例は lease.integration.test.ts を参照。 */
const url = process.env.REDIS_URL ?? '';
const password = process.env.REDIS_PASSWORD || undefined;

const waitUntil = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await sleep(20);
};

describe.skipIf(!url)('connectRedis (Redis統合)', () => {
    it('REDIS_URL と REDIS_PASSWORD で繋がり、/health が ready になる', async () => {
        const log = { warn: vi.fn(), info: vi.fn() };
        const client = connectRedis({ url, password }, log);
        try {
            await waitUntil(() => client.isReady);
            expect(redisHealth(client)).toBe('ready');
            expect(await client.sendCommand(['PING'])).toBe('PONG');
            expect(log.warn).not.toHaveBeenCalled();
        } finally {
            await client.close();
        }
    });

    it.skipIf(!password)('パスワードが違えば unavailable のまま（backend は落ちない）', async () => {
        const log = { warn: vi.fn(), info: vi.fn() };
        const client = connectRedis({ url, password: `${password}-wrong` }, log);
        try {
            await sleep(300);
            expect(redisHealth(client)).toBe('unavailable');
            expect(log.warn).toHaveBeenCalled();
        } finally {
            client.destroy();
        }
    });
});
