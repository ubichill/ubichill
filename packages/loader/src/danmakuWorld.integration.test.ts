import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColliderData, ComponentInstance } from '@ubichill/sdk';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { bulletTouchesCollider, collidesWithSolid, PLAYER_COLLIDER } from '../../../mods/danmaku/src/collision';

interface WorldEntityFixture {
    id: string;
    transform: ComponentInstance['transform'];
    components: Array<{ id?: string; type: string; data: unknown }>;
}

const world = parse(readFileSync(resolve(process.cwd(), 'worlds/danmaku.yaml'), 'utf8')) as {
    spec: { initialEntities: WorldEntityFixture[] };
};

function colliderInstances(): ComponentInstance<ColliderData>[] {
    return world.spec.initialEntities.flatMap((entity) =>
        entity.components
            .filter(
                (component): component is typeof component & { data: ColliderData } =>
                    component.type === 'core:collider',
            )
            .map((component) => ({
                id: `${entity.id}::${component.id ?? 'collider'}`,
                entityId: entity.id,
                type: component.type,
                ownerId: null,
                lockedBy: null,
                transform: entity.transform,
                data: component.data,
            })),
    );
}

describe('worlds/danmaku.yaml collision smoke test', () => {
    it('実ワールドには自機Colliderと5枚の壁Colliderがある', () => {
        const colliders = colliderInstances();
        expect(colliders.filter((entry) => entry.data.layer === 'player')).toHaveLength(1);
        expect(colliders.filter((entry) => entry.data.layer === 'wall')).toHaveLength(5);
    });

    it('自機は左壁で停止し、中央壁に当たった弾は消滅判定になる', () => {
        const colliders = colliderInstances();
        expect(
            collidesWithSolid(
                { x: 90, y: 400, z: 10, w: 20, h: 20, scale: 1, rotation: 0 },
                PLAYER_COLLIDER,
                colliders,
                'ship',
            ),
        ).toBe(true);
        expect(bulletTouchesCollider({ x: 400, y: 303 }, colliders)).toBe(true);
        expect(bulletTouchesCollider({ x: 200, y: 303 }, colliders)).toBe(false);
    });
});
