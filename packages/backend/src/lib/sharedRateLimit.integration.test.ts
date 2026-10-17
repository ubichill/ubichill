import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuthRateLimitStorage } from './authRateLimit';
import { rateLimitContract } from './rateLimitContract';
import { sharedRateLimit } from './sharedRateLimit';

/**
 * 2 つの backend（別々の接続）が同じ Redis で数を合算することを確かめる。REDIS_URL がある時だけ走る。
 * 実行例は services/lease.integration.test.ts を参照。
 */
const RUN = !!process.env.REDIS_URL;
const connect = () => createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined });
const quietLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe.skipIf(!RUN)('Redis で共有するレート制限 (Redis統合)', () => {
    // backend 2 台ぶんの接続
    const replicas = [connect(), connect()];
    const run = randomBytes(6).toString('hex');
    const counter = { next: 0 };

    beforeAll(async () => {
        await Promise.all(replicas.map((c) => c.connect()));
    });
    afterAll(async () => {
        const keys = [
            ...(await replicas[0].keys(`ubi:rl:test-${run}*`)),
            ...(await replicas[0].keys(`ubi:test:auth-rl:${run}:*`)),
        ];
        if (keys.length > 0) await replicas[0].del(keys);
        await Promise.all(replicas.map((c) => c.close()));
    });

    describe('HTTP（rate-limit-redis）', () => {
        rateLimitContract(() => {
            counter.next += 1;
            const space = `test-${run}-${counter.next}`;
            return {
                options: (name, replica) => sharedRateLimit(`${space}-${name}`, replicas[replica], quietLog()),
                shared: true,
            };
        });
    });

    describe('better-auth（customStorage）', () => {
        const storageOf = (replica: number, space: string) =>
            createAuthRateLimitStorage(replicas[replica], quietLog(), `ubi:test:auth-rl:${run}:${space}:`);

        it('2 つの backend の数が合算され、超えたら残りの秒数を返す', async () => {
            const a = storageOf(0, 'sum');
            const b = storageOf(1, 'sum');
            const rule = { window: 10, max: 3 };
            const key = '203.0.113.1|/sign-in/email';
            const results = [
                await a.consume(key, rule),
                await b.consume(key, rule),
                await a.consume(key, rule),
                await b.consume(key, rule),
            ];
            expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
            expect(results[3]?.retryAfter).toBeGreaterThanOrEqual(9);
            expect(results[3]?.retryAfter).toBeLessThanOrEqual(10);
            // IP・口が違えば別に数える
            expect((await a.consume('203.0.113.2|/sign-in/email', rule)).allowed).toBe(true);
            expect((await a.consume('203.0.113.1|/get-session', rule)).allowed).toBe(true);
        });

        it('同時に来ても上限を超えて通さない', async () => {
            const a = storageOf(0, 'race');
            const b = storageOf(1, 'race');
            const rule = { window: 10, max: 5 };
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).consume('198.51.100.1|/sign-in/email', rule)),
            );
            expect(results.filter((r) => r.allowed)).toHaveLength(5);
        });

        it('窓が過ぎたら数え直す', async () => {
            const a = storageOf(0, 'window');
            const rule = { window: 1, max: 1 };
            expect((await a.consume('k|/sign-in/email', rule)).allowed).toBe(true);
            expect((await a.consume('k|/sign-in/email', rule)).allowed).toBe(false);
            await sleep(1100);
            expect((await a.consume('k|/sign-in/email', rule)).allowed).toBe(true);
        });
    });
});
