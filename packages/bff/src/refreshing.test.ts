import { describe, expect, it } from 'vitest';
import { createRefreshing } from './refreshing';

function setup(results: Array<string | undefined | Error>) {
    const clock = { now: 0 };
    const calls = { count: 0 };
    const pending: Array<() => void> = [];
    const refreshing = createRefreshing<string>({
        load: () => {
            calls.count += 1;
            const result = results.shift();
            return new Promise((resolve, reject) => {
                pending.push(() => (result instanceof Error ? reject(result) : resolve(result)));
            });
        },
        ttlMs: 30_000,
        retryMs: 5_000,
        now: () => clock.now,
    });
    const settle = async () => {
        for (const release of pending.splice(0)) release();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { refreshing, clock, calls, settle };
}

describe('createRefreshing', () => {
    it('最初は読み終わるのを待ち、同時に来ても 1 回だけ読む', async () => {
        const { refreshing, calls, settle } = setup(['v1']);
        const both = Promise.all([refreshing.get(), refreshing.get()]);
        await settle();
        expect(await both).toEqual(['v1', 'v1']);
        expect(calls.count).toBe(1);
    });

    it('古くなったら覚えている値をすぐ返し、裏で読み直す', async () => {
        const { refreshing, clock, calls, settle } = setup(['v1', 'v2']);
        const first = refreshing.get();
        await settle();
        await first;
        clock.now = 30_000;
        expect(await refreshing.get()).toBe('v1');
        expect(calls.count).toBe(2);
        await settle();
        expect(await refreshing.get()).toBe('v2');
    });

    it('読めなかったら覚えている値を捨てず、しばらくは読みに行かない', async () => {
        const { refreshing, clock, calls, settle } = setup(['v1', new Error('down'), undefined, 'v3']);
        const first = refreshing.get();
        await settle();
        await first;
        clock.now = 31_000;
        expect(await refreshing.get()).toBe('v1');
        await settle();
        clock.now = 32_000;
        expect(await refreshing.get()).toBe('v1');
        expect(calls.count).toBe(2);
        clock.now = 37_000;
        expect(await refreshing.get()).toBe('v1');
        await settle();
        expect(calls.count).toBe(3);
    });

    it('一度も読めていないうちに失敗したら、しばらくは待たせずに undefined を返す', async () => {
        const { refreshing, clock, calls, settle } = setup([new Error('down'), 'v1']);
        const first = refreshing.get();
        await settle();
        expect(await first).toBeUndefined();
        clock.now = 1_000;
        expect(await refreshing.get()).toBeUndefined();
        expect(calls.count).toBe(1);
        clock.now = 6_000;
        const retried = refreshing.get();
        await settle();
        expect(await retried).toBe('v1');
    });
});
