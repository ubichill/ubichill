import { describe, expect, it } from 'vitest';
import { mapInChunks } from './mapInChunks';

describe('mapInChunks', () => {
    it('順序を保ち、同時に動くのは concurrency 件まで', async () => {
        const state = { running: 0, max: 0 };
        const result = await mapInChunks(
            Array.from({ length: 11 }, (_, i) => i),
            async (n) => {
                state.running += 1;
                state.max = Math.max(state.max, state.running);
                await new Promise((r) => setTimeout(r, 11 - n));
                state.running -= 1;
                return n * 2;
            },
            4,
        );
        expect(result).toEqual(Array.from({ length: 11 }, (_, i) => i * 2));
        expect(state.max).toBe(4);
    });

    it('空なら何もしない', async () => {
        expect(await mapInChunks([], async () => 1, 3)).toEqual([]);
    });
});
