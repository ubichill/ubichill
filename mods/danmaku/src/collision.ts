/**
 * このゲームの当たり判定の「方針」。
 *
 * 重なりの計算そのものは SDK (`findOverlapping`) が持つ。ここに書くのは
 * 「何を壁とみなすか」「弾はどの層に当たるか」といったこのゲーム固有の決めごとだけ。
 *
 * 接触イベント (`collision:enter`) ではなく問い合わせを使っているのは用途が違うため:
 *  - 自機の移動は「動く前」に行けるかを確かめる必要がある（イベントが届く頃には埋まっている）
 *  - 弾は Entity ではなく Worker 内のただの点なので、Host は存在を知らずイベントを出せない
 */

import { type ColliderData, type ComponentInstance, findOverlapping, isOverlapping } from 'ubichill';

export type ColliderInstance = ComponentInstance<ColliderData>;

export const PLAYER_COLLIDER: ColliderData = {
    shape: 'rect',
    size: 'entity',
    offset: { x: 0, y: 0 },
    isTrigger: false,
    layer: 'player',
    mask: ['wall'],
};

export const BULLET_COLLIDER: ColliderData = {
    shape: 'circle',
    radius: 4,
    offset: { x: 0, y: 0 },
    isTrigger: true,
    layer: 'bullet',
    mask: ['wall'],
};

/**
 * その位置へ動いたら「押し戻される相手」に当たるか。
 * trigger 同士はすり抜ける、というのがこのゲームの方針。
 */
export function collidesWithSolid(
    transform: ComponentInstance['transform'],
    moving: ColliderData,
    colliders: readonly ColliderInstance[],
    ownEntityId?: string,
): boolean {
    if (moving.isTrigger) return false;
    return findOverlapping({ transform, data: moving, entityId: ownEntityId }, colliders).some(
        (target) => !target.data.isTrigger,
    );
}

/** 弾が何かに当たったか。弾は trigger なので、当たった相手が壁でも消えるだけで押し戻さない。 */
export function bulletTouchesCollider(
    point: { x: number; y: number },
    colliders: readonly ColliderInstance[],
): boolean {
    return isOverlapping({ transform: point, data: BULLET_COLLIDER }, colliders);
}
