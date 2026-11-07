import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryLease, type Lease } from './lease';
import { createLeaseGate } from './leaseGate';

const quietLog = () => ({ info: vi.fn(), warn: vi.fn() });
const fakeClock = () => {
    const clock = { now: Date.UTC(2026, 0, 1) };
    return {
        now: () => clock.now,
        advance: (ms: number) => {
            clock.now += ms;
        },
    };
};

describe('createLeaseGate', () => {
    it('同じリースを見る 2 台のうち 1 台だけが通り、持ち主は延長し続ける', async () => {
        const clock = fakeClock();
        const lease = createMemoryLease(clock.now);
        const a = createLeaseGate(lease, 'reaper', 1000, quietLog());
        const b = createLeaseGate(lease, 'reaper', 1000, quietLog());
        expect(await a.hold()).toBe(true);
        expect(await b.hold()).toBe(false);
        // 期限より短い間隔で延長していれば、合計で期限を超えても渡らない
        for (const _ of [1, 2, 3]) {
            clock.advance(600);
            expect(await a.hold()).toBe(true);
            expect(await b.hold()).toBe(false);
        }
    });

    it('持ち主が延長しなくなったら、期限のあとにほかの 1 台が引き継ぎ、元の持ち主は通らない', async () => {
        const clock = fakeClock();
        const lease = createMemoryLease(clock.now);
        const a = createLeaseGate(lease, 'reaper', 1000, quietLog());
        const b = createLeaseGate(lease, 'reaper', 1000, quietLog());
        await a.hold();
        clock.advance(1000);
        expect(await b.hold()).toBe(true);
        expect(await a.hold()).toBe(false);
    });

    it('手放したらほかの 1 台がすぐ引き継げる', async () => {
        const lease = createMemoryLease();
        const a = createLeaseGate(lease, 'reaper', 60_000, quietLog());
        const b = createLeaseGate(lease, 'reaper', 60_000, quietLog());
        await a.hold();
        await a.release();
        expect(await b.hold()).toBe(true);
        await a.release();
        expect(await a.hold()).toBe(false);
    });

    it('同時に呼んでも取得の要求は 1 回にまとまる', async () => {
        const lease = createMemoryLease();
        const acquire = vi.spyOn(lease, 'acquire');
        const gate = createLeaseGate(lease, 'reaper', 1000, quietLog());
        expect(await Promise.all([gate.hold(), gate.hold(), gate.hold()])).toEqual([true, true, true]);
        expect(acquire).toHaveBeenCalledTimes(1);
    });

    it('Redis が落ちている間は通さず、警告は 1 回だけ。戻れば同じ token で続けられる', async () => {
        const inner = createMemoryLease();
        const state = { down: false };
        const flaky: Lease = {
            acquire: (...args) => (state.down ? Promise.reject(new Error('closed')) : inner.acquire(...args)),
            renew: (...args) => (state.down ? Promise.reject(new Error('closed')) : inner.renew(...args)),
            release: (...args) => (state.down ? Promise.reject(new Error('closed')) : inner.release(...args)),
        };
        const log = quietLog();
        const gate = createLeaseGate(flaky, 'reaper', 60_000, log);
        expect(await gate.hold()).toBe(true);
        state.down = true;
        expect(await gate.hold()).toBe(false);
        expect(await gate.hold()).toBe(false);
        expect(log.warn).toHaveBeenCalledTimes(1);
        state.down = false;
        const acquire = vi.spyOn(inner, 'acquire');
        expect(await gate.hold()).toBe(true);
        expect(acquire).not.toHaveBeenCalled();
        expect(log.info).toHaveBeenLastCalledWith(expect.stringContaining('Redis が戻りました'));
    });
});

describe('LeaseGate.run', () => {
    afterEach(() => vi.useRealTimers());

    it('長い処理の途中も更新し、別 backend にリースを渡さない', async () => {
        vi.useFakeTimers();
        const lease = createMemoryLease();
        const a = createLeaseGate(lease, 'reaper', 1500, quietLog());
        const b = createLeaseGate(lease, 'reaper', 1500, quietLog());
        let finish!: () => void;
        const blocked = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const work = vi.fn(async (checkpoint: () => Promise<boolean>) => {
            await blocked;
            return checkpoint();
        });
        const running = a.run(work);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(await b.hold()).toBe(false);
        finish();
        expect(await running).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('失効後に別 backend が取ったら、元の処理は取り直さず副作用を止める', async () => {
        vi.useFakeTimers();
        const lease = createMemoryLease();
        const a = createLeaseGate(lease, 'reaper', 1500, quietLog());
        const b = createLeaseGate(lease, 'reaper', 1500, quietLog());
        let finish!: () => void;
        const blocked = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const effect = vi.fn();
        const running = a.run(async (checkpoint) => {
            await blocked;
            if (await checkpoint()) effect();
        });
        await vi.advanceTimersByTimeAsync(0);
        const renew = vi.spyOn(lease, 'renew').mockResolvedValue(false);
        await vi.advanceTimersByTimeAsync(1500);
        renew.mockRestore();
        expect(await b.hold()).toBe(true);
        finish();
        await running;
        expect(effect).not.toHaveBeenCalled();
    });

    it('延長の応答が止まっても checkpoint は期限内に false を返す', async () => {
        vi.useFakeTimers();
        const lease = createMemoryLease();
        const gate = createLeaseGate(lease, 'reaper', 1500, quietLog());
        const running = gate.run(async (checkpoint) => {
            vi.spyOn(lease, 'renew').mockImplementation(() => new Promise(() => undefined));
            return checkpoint();
        });
        await vi.advanceTimersByTimeAsync(600);
        expect(await running).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
