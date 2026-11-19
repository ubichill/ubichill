import { MemoryStore, type Store } from 'express-rate-limit';
import { describe, expect, it } from 'vitest';
import { createWindowCounter } from './windowCounter';

describe('窓ごとの回数', () => {
    it('上限までは take が通り、超えたら断る。exceeded は数えずに見るだけ', async () => {
        const counter = createWindowCounter(new MemoryStore(), { limit: 2, windowMs: 60_000 });
        expect(await counter.exceeded('1.2.3.4')).toBe(false);
        expect(await counter.exceeded('1.2.3.4')).toBe(false);
        expect([await counter.take('1.2.3.4'), await counter.take('1.2.3.4')]).toEqual([true, true]);
        expect(await counter.exceeded('1.2.3.4')).toBe(true);
        expect(await counter.take('1.2.3.4')).toBe(false);
        // キーごとに別
        expect(await counter.exceeded('5.6.7.8')).toBe(false);
    });

    it('同時に数えても上限を超えて通さない', async () => {
        const counter = createWindowCounter(new MemoryStore(), { limit: 5, windowMs: 60_000 });
        const results = await Promise.all(Array.from({ length: 50 }, () => counter.take('all')));
        // MemoryStore は数を同じオブジェクトで返すので、同じ瞬間に数えた分は多めに断ることがある（少なく数えはしない）
        expect(results.filter(Boolean).length).toBeLessThanOrEqual(5);
        expect(await counter.exceeded('all')).toBe(true);
    });

    it('数えられない（Redis が落ちている）ときは通す（ほかの limiter と同じ）', async () => {
        const down: Store = {
            init: () => undefined,
            get: async () => Promise.reject(new Error('down')),
            increment: async () => Promise.reject(new Error('down')),
            decrement: async () => undefined,
            resetKey: async () => undefined,
        };
        const counter = createWindowCounter(down, { limit: 0, windowMs: 60_000 });
        expect(await counter.exceeded('x')).toBe(false);
        expect(await counter.take('x')).toBe(true);
    });
});
