import { describe, expect, it, vi } from 'vitest';
import { createConsoleStore } from './consoleStore';

const err = { level: 'error', source: 'pen', message: '読み込めませんでした' } as const;

/** 知らせを手で流せる store。 */
function manualStore() {
    const queue: Array<() => void> = [];
    const store = createConsoleStore({ now: () => 7, schedule: (run) => queue.push(run) });
    const flush = () => {
        for (const run of queue.splice(0)) run();
    };
    return { store, flush };
}

describe('createConsoleStore', () => {
    it('同じ処理の中の記録は、知らせを 1 回にまとめる', () => {
        const { store, flush } = manualStore();
        const listener = vi.fn();
        store.subscribe(listener);
        store.log(err);
        store.log({ ...err, message: 'b' });
        store.log({ ...err, message: 'c' });
        expect(listener).not.toHaveBeenCalled();
        flush();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.getEntries().map((e) => e.message)).toEqual(['読み込めませんでした', 'b', 'c']);
    });

    it('クリアしたあとも ID を使い回さない（選んでいた行を別の行と取り違えない）', () => {
        const { store } = manualStore();
        store.log(err);
        store.log({ ...err, message: 'b' });
        store.clear();
        store.log(err);
        expect(store.getEntries().map((e) => e.id)).toEqual([3]);
    });

    it('空のときのクリアは知らせない', () => {
        const { store, flush } = manualStore();
        const listener = vi.fn();
        store.subscribe(listener);
        store.clear();
        flush();
        expect(listener).not.toHaveBeenCalled();
    });

    it('購読をやめたら知らせない', () => {
        const { store, flush } = manualStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        unsubscribe();
        store.log(err);
        flush();
        expect(listener).not.toHaveBeenCalled();
    });

    it('記録したものを開発者ツールにも渡す', () => {
        const mirror = vi.fn();
        const store = createConsoleStore({ schedule: () => {}, mirror });
        store.log(err);
        expect(mirror).toHaveBeenCalledWith(err);
    });

    it('getEntries は変わるまで同じ配列を返す（useSyncExternalStore が描き直し続けない）', () => {
        const { store } = manualStore();
        store.log(err);
        expect(store.getEntries()).toBe(store.getEntries());
    });
});
