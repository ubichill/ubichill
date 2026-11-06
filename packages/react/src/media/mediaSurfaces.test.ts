import { describe, expect, it, vi } from 'vitest';
import { createMediaSurfaceRegistry } from './mediaSurfaces';

const surface = (fit: 'contain' | 'cover' = 'contain') => ({ element: {} as HTMLElement, fit });

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

    it('同じ Entity の 2 つ目の面は無視し、2 つ目を外しても先の面は残る', () => {
        const registry = createMediaSurfaceRegistry();
        const first = surface('contain');
        registry.register('tv', first);
        const unregisterSecond = registry.register('tv', surface('cover'));
        unregisterSecond();
        expect(registry.get('tv')).toBe(first);
    });

    it('外したあとに同じ Entity へ別の面を登録できる（作り直し）', () => {
        const registry = createMediaSurfaceRegistry();
        const unregister = registry.register('tv', surface());
        unregister();
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
