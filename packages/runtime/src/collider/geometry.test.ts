import { describe, expect, it } from 'vitest';
import { containsPoint, matchesCollisionLayers, overlaps, resolveColliderGeometry } from './geometry';
import type { ColliderData } from './types';

/**
 * 幾何計算は Zod に依存しない純粋な層なので、テストでも値を直接組み立てる。
 * スキーマの既定値やバリデーションは core-components 側の責務。
 */
function rect(overrides: Partial<Extract<ColliderData, { shape: 'rect' }>> = {}): ColliderData {
    return {
        shape: 'rect',
        size: 'entity',
        offset: { x: 0, y: 0 },
        isTrigger: true,
        layer: 'default',
        mask: ['default'],
        ...overrides,
    };
}

describe('core:collider geometry', () => {
    it('Entity transform + offset から矩形geometryを解決する', () => {
        const collider = rect({ offset: { x: 2, y: 3 }, size: { w: 10, h: 20 } });
        expect(resolveColliderGeometry({ x: 10, y: 20, scale: 2 }, collider)).toEqual({
            shape: 'rect',
            x: 14,
            y: 26,
            w: 20,
            h: 40,
        });
    });

    it('size: entity はUIと同じEntity transformのw/hを使う', () => {
        const collider = rect({ size: 'entity' });
        expect(resolveColliderGeometry({ x: 10, y: 20, w: 32, h: 28, scale: 1 }, collider)).toEqual({
            shape: 'rect',
            x: 10,
            y: 20,
            w: 32,
            h: 28,
        });
    });

    it('rect / circle / mixed の接触を判定する', () => {
        const rect = { shape: 'rect', x: 0, y: 0, w: 10, h: 10 } as const;
        expect(overlaps(rect, { shape: 'rect', x: 9, y: 9, w: 2, h: 2 })).toBe(true);
        expect(overlaps(rect, { shape: 'circle', x: 12, y: 5, radius: 2 })).toBe(true);
        expect(overlaps(rect, { shape: 'circle', x: 13, y: 5, radius: 2 })).toBe(false);
        expect(containsPoint(rect, { x: 10, y: 10 })).toBe(true);
    });

    it('layer/mask は双方が許可した組み合わせだけ接触させる', () => {
        const body = rect({ layer: 'body', mask: ['terrain'] });
        const terrain = rect({ layer: 'terrain', mask: ['body'] });
        // 片側からしか相手を指していない層とは接触しない
        const oneWay = rect({ layer: 'one-way', mask: ['body'] });

        expect(matchesCollisionLayers(body, terrain)).toBe(true);
        expect(matchesCollisionLayers(body, oneWay)).toBe(false);
    });
});
