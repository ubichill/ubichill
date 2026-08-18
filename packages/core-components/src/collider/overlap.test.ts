import { describe, expect, it } from 'vitest';
import { containsPoint, matchesCollisionLayers, overlaps, resolveColliderGeometry } from './overlap';
import { ColliderDataSchema } from './schema';

describe('core:collider geometry', () => {
    it('Entity transform + offset から矩形geometryを解決する', () => {
        const collider = ColliderDataSchema.parse({ shape: 'rect', offset: { x: 2, y: 3 }, size: { w: 10, h: 20 } });
        expect(resolveColliderGeometry({ x: 10, y: 20, scale: 2 }, collider)).toEqual({
            shape: 'rect',
            x: 14,
            y: 26,
            w: 20,
            h: 40,
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
        const player = ColliderDataSchema.parse({
            shape: 'rect',
            size: { w: 20, h: 20 },
            layer: 'player',
            mask: ['wall'],
        });
        const wall = ColliderDataSchema.parse({
            shape: 'rect',
            size: { w: 20, h: 20 },
            layer: 'wall',
            mask: ['player'],
        });
        const sensor = ColliderDataSchema.parse({
            shape: 'rect',
            size: { w: 20, h: 20 },
            layer: 'sensor',
            mask: ['player'],
        });

        expect(matchesCollisionLayers(player, wall)).toBe(true);
        expect(matchesCollisionLayers(player, sensor)).toBe(false);
    });
});
