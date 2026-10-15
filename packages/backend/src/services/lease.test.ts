import { describe, expect, it } from 'vitest';
import { createMemoryLease } from './lease';
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
