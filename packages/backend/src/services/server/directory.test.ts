import { describe, expect, it } from 'vitest';
import { createDirectory } from './directory';

function setup(indexable = true) {
    const clock = { now: 0 };
    const calls: number[] = [];
    const results: Array<string[] | Error> = [['aya', 'bob'], new Error('db down'), ['aya', 'bob', 'chika']];
    const directory = createDirectory({
        listHandles: async (limit) => {
            calls.push(limit);
            const next = results.shift() ?? [];
            if (next instanceof Error) throw next;
            return next;
        },
        indexable,
        limit: 10_000,
        ttlMs: 60_000,
        now: () => clock.now,
    });
    return { directory, clock, calls };
}

describe('createDirectory', () => {
    it('本番でなければ出さず、DB も引かない', async () => {
        const { directory, calls } = setup(false);
        expect(await directory.handles()).toBeNull();
        expect(calls).toEqual([]);
    });

    it('上限の数で引き、しばらくは覚えた値を返す。同時に来ても 1 回だけ引く', async () => {
        const { directory, clock, calls } = setup();
        expect(await Promise.all([directory.handles(), directory.handles()])).toEqual([
            ['aya', 'bob'],
            ['aya', 'bob'],
        ]);
        clock.now = 59_999;
        expect(await directory.handles()).toEqual(['aya', 'bob']);
        expect(calls).toEqual([10_000]);
    });

    it('引けなければ失敗を返し、覚えた値は次に引き直すまで使わない（失敗を覚えない）', async () => {
        const { directory, clock } = setup();
        await directory.handles();
        clock.now = 60_000;
        await expect(directory.handles()).rejects.toThrow('db down');
        expect(await directory.handles()).toEqual(['aya', 'bob', 'chika']);
    });
});
