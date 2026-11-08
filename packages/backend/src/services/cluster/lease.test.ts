import { describe, expect, it } from 'vitest';
import { createMemoryLease, leaseFor } from './lease';
import { leaseContract } from './leaseContract';

const fakeClock = () => {
    const clock = { now: Date.UTC(2026, 0, 1) };
    return {
        now: () => clock.now,
        advance: async (ms: number) => {
            clock.now += ms;
        },
    };
};

describe('createMemoryLease', () => {
    leaseContract(() => {
        const clock = fakeClock();
        return { lease: createMemoryLease(clock.now), advance: clock.advance };
    });

    it('ちょうど ttl が過ぎた時点で空く', async () => {
        const clock = fakeClock();
        const lease = createMemoryLease(clock.now);
        await lease.acquire('a', 1000);
        await clock.advance(999);
        expect(await lease.acquire('a', 1000)).toBeNull();
        await clock.advance(1);
        expect(await lease.acquire('a', 1000)).not.toBeNull();
    });
});

describe('leaseFor', () => {
    it('Redis を設定していれば、Redis が落ちてもメモリへ切り替えずに失敗を返す', async () => {
        const down = { sendCommand: async () => Promise.reject(new Error('The client is closed')) };
        const lease = leaseFor(down);
        await expect(lease.acquire('reaper', 1000)).rejects.toThrow('closed');
        await expect(lease.renew('reaper', 'token', 1000)).rejects.toThrow('closed');
    });

    it('Redis を設定していなければ、プロセス内のリースで動く', async () => {
        const lease = leaseFor(undefined);
        const token = await lease.acquire('reaper', 1000);
        expect(token).not.toBeNull();
        expect(await lease.acquire('reaper', 1000)).toBeNull();
    });
});
