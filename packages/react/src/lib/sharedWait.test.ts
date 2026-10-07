import { describe, expect, it, vi } from 'vitest';
import { createSharedWait } from './sharedWait';

describe('createSharedWait', () => {
    it('決定が出たら、取り消していない全員に同じ値を返す', async () => {
        const decision = Promise.withResolvers<string>();
        const join = createSharedWait(decision.promise, 'abandoned', vi.fn());
        const a = join(new AbortController().signal);
        const b = join();
        decision.resolve('yes');
        await expect(Promise.all([a, b])).resolves.toEqual(['yes', 'yes']);
    });

    it('全員が取り消したときだけ onAbandon を 1 回呼ぶ', async () => {
        const onAbandon = vi.fn();
        const join = createSharedWait(new Promise<string>(() => {}), 'abandoned', onAbandon);
        const first = new AbortController();
        const second = new AbortController();
        const a = join(first.signal);
        const b = join(second.signal);

        first.abort();
        await expect(a).resolves.toBe('abandoned');
        expect(onAbandon).not.toHaveBeenCalled();

        second.abort();
        await expect(b).resolves.toBe('abandoned');
        expect(onAbandon).toHaveBeenCalledTimes(1);
    });

    it('決定の後に取り消しても onAbandon は呼ばない', async () => {
        const onAbandon = vi.fn();
        const controller = new AbortController();
        const join = createSharedWait(Promise.resolve('yes'), 'abandoned', onAbandon);
        await expect(join(controller.signal)).resolves.toBe('yes');
        controller.abort();
        expect(onAbandon).not.toHaveBeenCalled();
    });

    it('取り消し済みの signal は数に入れず、すぐ abandonedValue を返す', async () => {
        const onAbandon = vi.fn();
        const controller = new AbortController();
        controller.abort();
        const join = createSharedWait(new Promise<string>(() => {}), 'abandoned', onAbandon);
        await expect(join(controller.signal)).resolves.toBe('abandoned');
        expect(onAbandon).not.toHaveBeenCalled();
    });
});
