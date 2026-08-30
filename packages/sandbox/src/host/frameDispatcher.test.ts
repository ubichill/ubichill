import { describe, expect, it, vi } from 'vitest';
import { createFrameDispatcher } from './frameDispatcher';

describe('createFrameDispatcher', () => {
    it('登録した順に呼ぶ（フレーム内の実行順を確定させる）', () => {
        const order: string[] = [];
        const d = createFrameDispatcher();
        d.add('a', () => order.push('a'));
        d.add('b', () => order.push('b'));
        d.add('c', () => order.push('c'));

        d.run(16);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('経過時間をそのまま渡す', () => {
        const seen: number[] = [];
        const d = createFrameDispatcher();
        d.add('a', (dt) => seen.push(dt));
        d.run(16.7);
        expect(seen).toEqual([16.7]);
    });

    it('remove すると呼ばれなくなる', () => {
        const fn = vi.fn();
        const d = createFrameDispatcher();
        d.add('a', fn);
        d.remove('a');
        d.run(16);
        expect(fn).not.toHaveBeenCalled();
    });

    // Worker は再生成されることがある。同じ key で二重に走ると tick が 2 回届く。
    it('同じ key の再登録は差し替えになる（二重登録しない）', () => {
        const first = vi.fn();
        const second = vi.fn();
        const d = createFrameDispatcher();
        d.add('a', first);
        d.add('a', second);

        d.run(16);
        expect(d.size()).toBe(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    // ループを 1 本に束ねた以上、mod 1 つの不具合でワールド全体の時間が止まってはいけない。
    describe('例外の隔離', () => {
        it('1 つが投げても後続は実行される', () => {
            const after = vi.fn();
            const onError = vi.fn();
            const d = createFrameDispatcher({ onError });
            d.add('broken', () => {
                throw new Error('boom');
            });
            d.add('healthy', after);

            d.run(16);
            expect(after).toHaveBeenCalledTimes(1);
            expect(onError).toHaveBeenCalledWith('broken', expect.any(Error));
        });

        it('投げ続けても次のフレームは走り続ける', () => {
            const healthy = vi.fn();
            const d = createFrameDispatcher({ onError: () => {} });
            d.add('broken', () => {
                throw new Error('boom');
            });
            d.add('healthy', healthy);

            d.run(16);
            d.run(16);
            d.run(16);
            expect(healthy).toHaveBeenCalledTimes(3);
        });

        it('run 自体は例外を投げない（呼び出し元のループを壊さない）', () => {
            const d = createFrameDispatcher({ onError: () => {} });
            d.add('broken', () => {
                throw new Error('boom');
            });
            expect(() => d.run(16)).not.toThrow();
        });
    });

    // tick 中に Worker が破棄されたり生成されたりする（mod が Entity を作る等）。
    describe('実行中の登録変更', () => {
        it('実行中に remove しても反復が壊れない', () => {
            const later = vi.fn();
            const d = createFrameDispatcher();
            d.add('a', () => d.remove('b'));
            d.add('b', vi.fn());
            d.add('c', later);

            expect(() => d.run(16)).not.toThrow();
            expect(later).toHaveBeenCalledTimes(1);
            expect(d.size()).toBe(2);
        });

        it('実行中に add した分は次のフレームから走る', () => {
            const added = vi.fn();
            const d = createFrameDispatcher();
            d.add('a', () => d.add('late', added));

            d.run(16);
            expect(added).not.toHaveBeenCalled();
            d.run(16);
            expect(added).toHaveBeenCalledTimes(1);
        });
    });

    it('購読者が居なければ何もしない', () => {
        const d = createFrameDispatcher();
        expect(d.size()).toBe(0);
        expect(() => d.run(16)).not.toThrow();
    });
});
