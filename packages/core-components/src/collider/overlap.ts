import type { CircleGeometry, ColliderData, ColliderGeometry, ColliderTransform, RectGeometry } from './types.js';

/** Entity transform とCollider dataからワールド座標の形状を解決する。rotationは物理層追加まで扱わない。 */
export function resolveColliderGeometry(transform: ColliderTransform, collider: ColliderData): ColliderGeometry {
    const scale = transform.scale ?? 1;
    const x = transform.x + collider.offset.x * scale;
    const y = transform.y + collider.offset.y * scale;
    if (collider.shape === 'rect') {
        return { shape: 'rect', x, y, w: collider.size.w * scale, h: collider.size.h * scale };
    }
    return { shape: 'circle', x, y, radius: collider.radius * scale };
}

export function overlaps(a: ColliderGeometry, b: ColliderGeometry): boolean {
    if (a.shape === 'rect') {
        return b.shape === 'rect' ? overlapsRectRect(a, b) : overlapsRectCircle(a, b);
    }
    return b.shape === 'circle' ? overlapsCircleCircle(a, b) : overlapsRectCircle(b, a);
}

/** 双方の layer/mask が互いを許可しているときだけ接触対象とする。 */
export function matchesCollisionLayers(a: ColliderData, b: ColliderData): boolean {
    return a.mask.includes(b.layer) && b.mask.includes(a.layer);
}

export function containsPoint(collider: ColliderGeometry, point: { x: number; y: number }): boolean {
    if (collider.shape === 'rect') {
        return (
            point.x >= collider.x &&
            point.x <= collider.x + collider.w &&
            point.y >= collider.y &&
            point.y <= collider.y + collider.h
        );
    }
    return Math.hypot(point.x - collider.x, point.y - collider.y) <= collider.radius;
}

function overlapsRectRect(a: RectGeometry, b: RectGeometry): boolean {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function overlapsCircleCircle(a: CircleGeometry, b: CircleGeometry): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius;
}

function overlapsRectCircle(rect: RectGeometry, circle: CircleGeometry): boolean {
    const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    return Math.hypot(circle.x - x, circle.y - y) <= circle.radius;
}
