import { describe, expect, it, vi } from 'vitest';
import { canDrawOnSurface, createMediaSurfaceRegistry } from './mediaSurfaces';

const surface = (fit: 'contain' | 'cover' = 'contain') => ({
    element: {} as HTMLElement,
    fit,
    output: { componentInstanceId: 'player::controls', field: 'screen' },
});

describe('createMediaSurfaceRegistry', () => {
    it('登録・取得・外すたびに購読者へ知らせる', () => {
        const registry = createMediaSurfaceRegistry();
        const listener = vi.fn();
        registry.subscribe(listener);
        const tv = surface();
        const unregister = registry.register('tv', tv);
        expect(registry.get('tv')).toBe(tv);
        unregister();
        expect(registry.get('tv')).toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('同じ Entity に面が 2 つあるあいだはどちらも使わない（登録の順に関わらない）', () => {
        const registry = createMediaSurfaceRegistry();
        registry.register('tv', surface('contain'));
        registry.register('tv', surface('cover'));
        expect(registry.get('tv')).toBeUndefined();
    });

    it('先に登録した面を外すと、残った面を使う（#298 のレビュー: 登録簿が空にならない）', () => {
        const registry = createMediaSurfaceRegistry();
        const unregisterFirst = registry.register('tv', surface('contain'));
        const second = surface('cover');
        registry.register('tv', second);
        unregisterFirst();
        expect(registry.get('tv')).toBe(second);
    });

    it('外す関数を 2 回呼んでも、ほかの面は外れない', () => {
        const registry = createMediaSurfaceRegistry();
        const unregister = registry.register('tv', surface());
        const other = surface('cover');
        registry.register('tv', other);
        unregister();
        unregister();
        expect(registry.get('tv')).toBe(other);
    });

    it('外したあとに同じ Entity へ別の面を登録できる（作り直し）', () => {
        const registry = createMediaSurfaceRegistry();
        const unregister = registry.register('tv', surface());
        unregister();
        const next = surface('cover');
        registry.register('tv', next);
        expect(registry.get('tv')).toBe(next);
    });

    it('購読をやめたら知らせない', () => {
        const registry = createMediaSurfaceRegistry();
        const listener = vi.fn();
        const unsubscribe = registry.subscribe(listener);
        unsubscribe();
        registry.register('tv', surface());
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('canDrawOnSurface', () => {
    it('面が決めた出力（インスタンスとフィールドの両方が一致）だけが描ける', () => {
        const tv = surface();
        expect(canDrawOnSurface(tv, 'player::controls', 'screen')).toBe(true);
        expect(canDrawOnSurface(tv, 'evil', 'screen')).toBe(false);
        expect(canDrawOnSurface(tv, 'player::controls', 'sub')).toBe(false);
    });

    it('面がまだ無ければ描けない', () => {
        expect(canDrawOnSurface(undefined, 'player::controls', 'screen')).toBe(false);
    });
});
