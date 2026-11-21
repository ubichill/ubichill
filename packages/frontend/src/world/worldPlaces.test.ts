import type { ComponentInstance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { entityCenter, spawnCenter } from './worldPlaces';

const placed = (type: string, entityId: string, x: number, y: number, w = 100, h = 50) => ({
    type,
    entityId,
    transform: { x, y, z: 0, w, h, scale: 1, rotation: 0 } satisfies ComponentInstance['transform'],
});

describe('entityCenter', () => {
    it('最初の Component の矩形の中心。大きさの無い Entity は置いた点', () => {
        const entities = [
            placed('core:text', 'sign', 100, 200),
            placed('core:image', 'sign', 0, 0),
            placed('a:b', 'pin', 10, 20, 0, 0),
        ];
        expect(entityCenter(entities, 'sign')).toEqual({ x: 150, y: 225 });
        expect(entityCenter(entities, 'pin')).toEqual({ x: 10, y: 20 });
        expect(entityCenter(entities, 'none')).toBeNull();
    });
});

describe('spawnCenter', () => {
    const entities = [
        placed('core:text', 'sign', 0, 0),
        placed('core:spawn', 'a', 100, 100),
        placed('core:spawn', 'b', 1000, 1000),
        placed('core:spawn', 'hidden', 5000, 5000),
    ];

    it('core:spawn から pick で選ぶ（1 に近い値でも範囲を出ない）', () => {
        expect(spawnCenter(entities, new Set(['hidden']), () => 0)).toEqual({ x: 150, y: 125 });
        expect(spawnCenter(entities, new Set(['hidden']), () => 0.9999)).toEqual({ x: 1050, y: 1025 });
    });

    it('見えない印は使わない。無ければ null', () => {
        expect(spawnCenter(entities.slice(3), new Set(['hidden']), () => 0)).toBeNull();
        expect(spawnCenter(entities.slice(0, 1), new Set(), () => 0)).toBeNull();
    });
});
