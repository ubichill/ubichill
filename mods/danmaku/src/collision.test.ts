import type { ColliderData, ComponentInstance } from '@ubichill/sdk';
import { describe, expect, it } from 'vitest';
import { bulletTouchesCollider, collidesWithSolid, PLAYER_COLLIDER } from './collision';

function wall(x: number, y: number, isTrigger = false): ComponentInstance<ColliderData> {
    return {
        id: `wall-${x}-${y}`,
        entityId: `wall-${x}-${y}`,
        type: 'core:collider',
        ownerId: null,
        lockedBy: null,
        transform: { x, y, z: 0, w: 20, h: 100, scale: 1, rotation: 0 },
        data: {
            shape: 'rect',
            size: { w: 20, h: 100 },
            offset: { x: 0, y: 0 },
            isTrigger,
            layer: 'wall',
            mask: ['player', 'bullet'],
        },
    };
}

const playerTransform = { x: 80, y: 100, z: 0, w: 20, h: 20, scale: 1, rotation: 0 };

describe('danmaku collider integration', () => {
    it('自機はsolid wallを通過できず、triggerは移動を妨げない', () => {
        expect(collidesWithSolid(playerTransform, PLAYER_COLLIDER, [wall(95, 100)])).toBe(true);
        expect(collidesWithSolid(playerTransform, PLAYER_COLLIDER, [wall(95, 100, true)])).toBe(false);
    });

    it('弾の円Colliderがwallに触れたことを検出する', () => {
        expect(bulletTouchesCollider({ x: 94, y: 110 }, [wall(95, 100)])).toBe(true);
        expect(bulletTouchesCollider({ x: 50, y: 110 }, [wall(95, 100)])).toBe(false);
    });
});
