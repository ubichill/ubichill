/** modにも公開できる、Zod非依存のCollider API。 */
export const CORE_COMPONENT_TYPES = {
    collider: 'core:collider',
} as const;

export type CoreComponentType = (typeof CORE_COMPONENT_TYPES)[keyof typeof CORE_COMPONENT_TYPES];

export { containsPoint, matchesCollisionLayers, overlaps, resolveColliderGeometry } from './collider/overlap.js';
export type {
    CircleCollider,
    CircleGeometry,
    ColliderData,
    ColliderGeometry,
    ColliderTransform,
    RectCollider,
    RectGeometry,
    Vec2,
} from './collider/types.js';
