/**
 * @ubichill/runtime — ワールドの実行時シミュレーション（純粋計算）。
 *
 * DOM もネットワークも時計も持たない。「今のワールドの状態」を渡すと「次に起きたこと」を
 * 返すだけなので、ブラウザでもサーバーでも同じコードが動く。
 * 当面はクライアントで回すが、権威をサーバーへ移す場合もこの層は差し替えずに済む。
 *
 * ここが持つのは Host 組み込み Component の**振る舞い**で、データ形式（Zod スキーマ）や
 * エディタ表示は `@ubichill/core-components` の担当。
 */

export { containsPoint, matchesCollisionLayers, overlaps, resolveColliderGeometry } from './collider/geometry.js';
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
export { createDefaultColliderData } from './collider/types.js';
export type { ColliderInstance, CollisionEvents, Contact, ContactCandidate } from './collision/contacts.js';
export { canContact, contactKey, detectContacts, diffContacts } from './collision/contacts.js';
export type { OverlapProbe } from './collision/query.js';
export { findOverlapping, isOverlapping } from './collision/query.js';
export type { CollisionTracker } from './collision/tracker.js';
export { createCollisionTracker } from './collision/tracker.js';
