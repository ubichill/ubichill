import {
    type ColliderData,
    type ComponentInstance,
    matchesCollisionLayers,
    overlaps,
    resolveColliderGeometry,
} from '@ubichill/sdk';

export type ColliderInstance = ComponentInstance<ColliderData>;

export const PLAYER_COLLIDER: ColliderData = {
    shape: 'rect',
    size: { w: 20, h: 20 },
    offset: { x: 0, y: 0 },
    isTrigger: false,
    layer: 'player',
    mask: ['wall'],
};

export const BULLET_COLLIDER: ColliderData = {
    shape: 'circle',
    radius: 3,
    offset: { x: 0, y: 0 },
    isTrigger: true,
    layer: 'bullet',
    mask: ['wall'],
};

export function collidesWithSolid(
    transform: ComponentInstance['transform'],
    moving: ColliderData,
    colliders: readonly ColliderInstance[],
    ownEntityId?: string,
): boolean {
    const movingGeometry = resolveColliderGeometry(transform, moving);
    return colliders.some(
        (target) =>
            target.entityId !== ownEntityId &&
            !moving.isTrigger &&
            !target.data.isTrigger &&
            matchesCollisionLayers(moving, target.data) &&
            overlaps(movingGeometry, resolveColliderGeometry(target.transform, target.data)),
    );
}

export function bulletTouchesCollider(
    point: { x: number; y: number },
    colliders: readonly ColliderInstance[],
): boolean {
    const bulletGeometry = resolveColliderGeometry(point, BULLET_COLLIDER);
    return colliders.some(
        (target) =>
            matchesCollisionLayers(BULLET_COLLIDER, target.data) &&
            overlaps(bulletGeometry, resolveColliderGeometry(target.transform, target.data)),
    );
}
