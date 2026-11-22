import { describe, expect, it } from 'vitest';
import type { LeaseGate } from '../cluster/leaseGate';
import { createWorldAssetSweep, WORLD_ASSET_SWEEP } from './worldAssetSweep';

const AT = new Date('2026-11-22T06:00:00Z');
const KB = 1024;
const HALF_MB = 512 * KB;

/** 消せる画像が `pending` 枚ある repository。呼ばれた cutoff・limit を残す */
function fakeRepository(pending: number, byteSize = 300 * KB) {
    const state = { pending, calls: [] as Array<{ cutoff: Date; limit: number }> };
    return {
        state,
        repository: {
            removeUnreferenced: async (cutoff: Date, limit: number) => {
                state.calls.push({ cutoff, limit });
                const n = Math.min(limit, state.pending);
                state.pending -= n;
                return Array.from({ length: n }, () => ({ byteSize }));
            },
        },
    };
}

/** checkpoint が `alive` 回まで true を返すリース（それ以降はほかの backend に渡った） */
const holdingGate = (alive = Number.POSITIVE_INFINITY): Pick<LeaseGate, 'run'> => {
    const seen = { n: 0 };
    return {
        run: (work) =>
            work(async () => {
                seen.n += 1;
                return seen.n <= alive;
            }),
    };
};

function setup(options: { pending: number; byteSize?: number; gate?: Pick<LeaseGate, 'run'> }) {
    const { state, repository } = fakeRepository(options.pending, options.byteSize);
    const logs: string[] = [];
    const sweep = createWorldAssetSweep({
        repository,
        gate: options.gate ?? holdingGate(),
        log: (message) => logs.push(message),
    });
    return { sweep, state, logs };
}

describe('createWorldAssetSweep', () => {
    it('上げてからちょうど 7 日前を境にして消させ、消した枚数と大きさを 1 行で残す', async () => {
        const { sweep, state, logs } = setup({ pending: 3, byteSize: HALF_MB });
        expect(await sweep.runOnce(AT)).toEqual({ count: 3, bytes: 3 * HALF_MB });
        expect(state.calls).toEqual([{ cutoff: new Date('2026-11-15T06:00:00Z'), limit: WORLD_ASSET_SWEEP.batch }]);
        expect(logs).toEqual(['使われていないワールドの画像を 3 枚（1.5 MB）消しました']);
    });

    it('リースを持っていなければ（ほかの backend が担当）何も消さない', async () => {
        const { sweep, state, logs } = setup({ pending: 3, gate: { run: async () => null } });
        expect(await sweep.runOnce(AT)).toBeNull();
        expect(state.calls).toEqual([]);
        expect(logs).toEqual([]);
    });

    it('消すものが無ければ何も残さない', async () => {
        const { sweep, logs } = setup({ pending: 0 });
        expect(await sweep.runOnce(AT)).toEqual({ count: 0, bytes: 0 });
        expect(logs).toEqual([]);
    });

    it('1 回の上限を越える分は続けて消す。ちょうど上限で終わっても、もう 1 回確かめてから止める', async () => {
        const many = setup({ pending: 2 * WORLD_ASSET_SWEEP.batch + 1, byteSize: 1 });
        expect(await many.sweep.runOnce(AT)).toEqual({ count: 1001, bytes: 1001 });
        expect(many.state.calls).toHaveLength(3);
        // 同じ回では同じ境を使う（途中で時刻を取り直さない）
        expect(new Set(many.state.calls.map((call) => call.cutoff.getTime())).size).toBe(1);

        const exact = setup({ pending: WORLD_ASSET_SWEEP.batch, byteSize: 1 });
        expect(await exact.sweep.runOnce(AT)).toEqual({ count: 500, bytes: 500 });
        expect(exact.state.calls).toHaveLength(2);
        expect(exact.state.pending).toBe(0);
    });

    it('途中でリースを失ったら次の DELETE をしない。それまでに消した分は知らせる', async () => {
        const { sweep, state, logs } = setup({
            pending: 3 * WORLD_ASSET_SWEEP.batch,
            byteSize: HALF_MB,
            gate: holdingGate(1),
        });
        expect(await sweep.runOnce(AT)).toEqual({ count: 500, bytes: 500 * HALF_MB });
        expect(state.calls).toHaveLength(1);
        expect(state.pending).toBe(1000);
        expect(logs).toEqual(['使われていないワールドの画像を 500 枚（250.0 MB）消しました']);
    });
});
