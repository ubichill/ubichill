import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findAll: vi.fn(), delete: vi.fn(), presence: vi.fn(), close: vi.fn() }));
vi.mock('@ubichill/db', () => ({ instanceRepository: { findAll: mocks.findAll, delete: mocks.delete } }));
vi.mock('../config', () => ({
    appConfig: { instance: { emptyTimeoutMs: 300, recoveryGraceMs: 300, reapIntervalMs: 100 } },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/redis', () => ({ redis: null }));
vi.mock('./maintenance', () => ({ maintenanceGate: { hold: async () => true, release: async () => {} } }));
vi.mock('./instanceRuntime', () => ({ instanceRuntime: { presence: mocks.presence, close: mocks.close } }));

import { createRedisAbsenceClock } from './absenceClock';
import { InstanceReaper } from './instanceReaper';
import { createRedisLease } from './lease';
import { createLeaseGate } from './leaseGate';

/**
 * 同じ Redis を見る 2 つの backend の reaper。REDIS_URL がある時だけ走る（実行例は lease.integration.test.ts）。
 * - 掃除するのはリースを持つ 1 台だけ
 * - リースが移っても、Go に部屋が無いと最初に観測した時刻（復旧猶予の起点）は引き継がれる
 */
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('InstanceReaper × 2 (Redis統合)', () => {
    const clients = [0, 1].map(() =>
        createClient({ url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD || undefined }),
    );
    const prefix = `ubi:test:reaper:${randomBytes(6).toString('hex')}:`;
    const counter = { next: 0 };
    const log = { info: vi.fn(), warn: vi.fn() };

    const pair = () => {
        counter.next += 1;
        const space = `${prefix}${counter.next}:`;
        return clients.map((client) => {
            const gate = createLeaseGate(createRedisLease(client, `${space}lease:`), 'reaper', 2000, log);
            const absence = createRedisAbsenceClock(client, 60_000, `${space}absent:`);
            return { gate, reaper: new InstanceReaper({ gate, absence }) };
        }) as [
            { gate: ReturnType<typeof createLeaseGate>; reaper: InstanceReaper },
            { gate: ReturnType<typeof createLeaseGate>; reaper: InstanceReaper },
        ];
    };

    beforeAll(async () => {
        await Promise.all(clients.map((c) => c.connect()));
    });
    afterAll(async () => {
        const keys = await clients[0].keys(`${prefix}*`);
        if (keys.length > 0) await clients[0].del(keys);
        await Promise.all(clients.map((c) => c.close()));
    });
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findAll.mockResolvedValue([{ id: 'room', createdAt: new Date(Date.now() - 60 * 60_000) }]);
        mocks.presence.mockResolvedValue(new Map());
        mocks.close.mockResolvedValue(true);
    });

    it('同時に回しても掃除するのは 1 台だけ', async () => {
        const [a, b] = pair();
        const rounds = await Promise.all(
            Array.from({ length: 5 }, async () => [await a.reaper.runOnce(), await b.reaper.runOnce()]),
        );
        const ran = rounds.flat().filter((r) => r !== null);
        expect(ran.length).toBe(5);
        // どの回も、走ったのは片方だけ（もう片方は null）
        expect(rounds.every(([x, y]) => (x === null) !== (y === null))).toBe(true);
        expect(mocks.findAll).toHaveBeenCalledTimes(5);
    });

    it('リースが移っても復旧猶予は延びない（最初に観測した時刻から数える）', async () => {
        const [a, b] = pair();
        expect(await a.reaper.runOnce()).toBe(0);
        expect(await b.reaper.runOnce()).toBeNull();
        await sleep(200);
        await a.gate.release();
        // B は引き継いだ直後。プロセス内の記録なら B はここから 300ms 数え直すが、共有の起点なら残りは 100ms
        expect(await b.reaper.runOnce()).toBe(0);
        await sleep(150);
        expect(await b.reaper.runOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
        expect(await a.reaper.runOnce()).toBeNull();
    });
});
