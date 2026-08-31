/**
 * 「今この形はどれと重なっているか」を問い合わせる（純関数）。
 *
 * 接触イベント（enter/exit）が「起きたこと」を後から知らせるのに対し、こちらは
 * 任意の形を渡してその場で答えを得る。用途が別なので両方が要る:
 *  - 移動して良いかを **動く前に** 確かめる（イベントでは、届いた時にはもう埋まっている）
 *  - Entity として登録されていないもの（描画だけの粒子・カーソル・範囲選択など）を突き合わせる
 *
 * 何を「ぶつかった」とみなすか（押し戻す/すり抜ける/ダメージ）は呼び出し側の方針なので、
 * ここでは重なっている相手をそのまま返すだけにして解釈を持たない。
 */

import { overlaps, resolveColliderGeometry } from '../collider/geometry.js';
import type { ColliderData, ColliderTransform } from '../collider/types.js';
import { type ColliderInstance, canContact } from './contacts.js';

/** 問い合わせる形。ワールドに登録されていなくてよい。 */
export interface OverlapProbe {
    transform: ColliderTransform;
    data: ColliderData;
    /** 自分自身を除外したい場合の GameObject id。 */
    entityId?: string;
}

/**
 * probe と重なっている collider を返す（layer/mask と同一 GameObject の除外は適用済み）。
 * 順序は渡された配列のまま。
 */
export function findOverlapping(probe: OverlapProbe, colliders: readonly ColliderInstance[]): ColliderInstance[] {
    const geometry = resolveColliderGeometry(probe.transform, probe.data);
    return colliders.filter(
        (target) =>
            canContact(probe, target) && overlaps(geometry, resolveColliderGeometry(target.transform, target.data)),
    );
}

/** 重なっている相手が 1 つでもあるか。`findOverlapping(...).length > 0` の短縮形。 */
export function isOverlapping(probe: OverlapProbe, colliders: readonly ColliderInstance[]): boolean {
    return findOverlapping(probe, colliders).length > 0;
}
