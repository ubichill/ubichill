import { describe, expect, it } from 'vitest';
import { createTtlCache } from './ttlCache';

describe('createTtlCache', () => {
    it('期限内は同じ結果を返し、期限を過ぎたら作り直す', async () => {
        const clock = { t: 0 };
        const cache = createTtlCache<number>({ ttlMs: 100, max: 10, now: () => clock.t });
        const calls = { n: 0 };
        const create = async () => ++calls.n;
        expect(await cache.getOrCreate('a', create)).toBe(1);
        expect(await cache.getOrCreate('a', create)).toBe(1);
        clock.t = 100;
        expect(await cache.getOrCreate('a', create)).toBe(2);
    });

    it('同時の呼び出しは 1 回の処理にまとめる（外部取得を重ねない）', async () => {
        const cache = createTtlCache<number>({ ttlMs: 100, max: 10 });
        const calls = { n: 0 };
        const create = async () => {
            calls.n += 1;
            await new Promise((r) => setTimeout(r, 5));
            return calls.n;
        };
        const results = await Promise.all([cache.getOrCreate('a', create), cache.getOrCreate('a', create)]);
        expect(results).toEqual([1, 1]);
        expect(calls.n).toBe(1);
    });

    it('失敗はキャッシュしない', async () => {
        const cache = createTtlCache<number>({ ttlMs: 100, max: 10 });
        await expect(cache.getOrCreate('a', () => Promise.reject(new Error('down')))).rejects.toThrow();
        expect(await cache.getOrCreate('a', async () => 7)).toBe(7);
    });

    it('delete で捨てられ、上限を超えたら古い項目から捨てる', async () => {
        const cache = createTtlCache<number>({ ttlMs: 1000, max: 2 });
        const calls = { n: 0 };
        const create = async () => ++calls.n;
        await cache.getOrCreate('a', create);
        await cache.getOrCreate('b', create);
        await cache.getOrCreate('c', create); // a が捨てられる
        expect(await cache.getOrCreate('b', create)).toBe(2);
        expect(await cache.getOrCreate('a', create)).toBe(4);
        cache.delete('b');
        expect(await cache.getOrCreate('b', create)).toBe(5);
    });
});
