/**
 * 接触判定（純関数）。
 *
 * 「今このフレームで触れ合っている組」を求める部分と、「前フレームと比べて何が始まり・
 * 続き・終わったか」を求める部分に分けてある。状態を持つのは呼び出し側（tracker）だけなので、
 * どちらも同じ入力なら必ず同じ結果になり、サーバーで回しても差が出ない。
 */

import { matchesCollisionLayers, overlaps, resolveColliderGeometry } from '../collider/geometry.js';
import type { ColliderData, ColliderTransform } from '../collider/types.js';

/** シミュレーション対象の Collider 1 個。 */
export interface ColliderInstance {
    /** Component インスタンスの id（接触の同一性はこれで見る）。 */
    id: string;
    /** 乗っている GameObject の id。同じ GameObject 上の Collider 同士は接触扱いしない。 */
    entityId?: string;
    transform: ColliderTransform;
    data: ColliderData;
}

/** 接触している 2 つの Collider。`a` < `b` で正規化してあるので順序が揺れない。 */
export interface Contact {
    a: string;
    b: string;
}

/** 前フレームとの差分。 */
export interface CollisionEvents {
    /** このフレームで触れ始めた組。 */
    entered: Contact[];
    /** 触れ続けている組。 */
    stayed: Contact[];
    /** このフレームで離れた組。 */
    exited: Contact[];
}

/**
 * 接触の同一性キー。id の組を順序非依存にすることで、
 * 「A→B」と「B→A」が別の接触として二重に扱われるのを防ぐ。
 * Component インスタンス id は kebab-case + `::` しか含まないので `|` と衝突しない。
 */
export function contactKey(contact: Contact): string {
    return `${contact.a}|${contact.b}`;
}

function normalize(x: string, y: string): Contact {
    return x < y ? { a: x, b: y } : { a: y, b: x };
}

/** 接触判定の相手として成立するか（形は見ない、関係だけを見る）。 */
export interface ContactCandidate {
    /** 乗っている GameObject の id。同じ GameObject 上の collider 同士は対象外。 */
    entityId?: string;
    data: ColliderData;
}

/**
 * 2 つの collider が「そもそも接触を判定する相手同士か」を返す。
 *
 * 判定するのは関係だけで、`isTrigger` は見ない。トリガーかどうかは押し戻すかの話であって
 * 触れたかの話ではないので、押し戻す/すり抜けるの解釈は受け手（mod）に委ねる。
 */
export function canContact(a: ContactCandidate, b: ContactCandidate): boolean {
    if (a.entityId !== undefined && a.entityId === b.entityId) return false;
    return matchesCollisionLayers(a.data, b.data);
}

/**
 * 現在フレームで接触している組をすべて返す。
 *
 * 除外するのは次の 2 つだけで、`isTrigger` では除外しない。トリガーかどうかは
 * 「押し戻すか」の話であって「触れたか」の話ではないため、判定結果は同じように返し、
 * 解釈は受け手に委ねる。
 *  - 同じ GameObject 上の Collider 同士（自分の当たり判定同士がぶつかっても意味がない）
 *  - layer/mask が互いを許可していない組
 *
 * 計算量は素朴な総当たり O(n^2)。広くなったら broad-phase をこの関数の内側に足せばよく、
 * 返り値の意味は変わらない。
 */
export function detectContacts(colliders: readonly ColliderInstance[]): Contact[] {
    const geometries = colliders.map((c) => resolveColliderGeometry(c.transform, c.data));
    return colliders.flatMap((a, i) =>
        colliders.slice(i + 1).flatMap((b, j) => {
            if (!canContact(a, b)) return [];
            const geometryB = geometries[i + 1 + j];
            const geometryA = geometries[i];
            if (!geometryA || !geometryB || !overlaps(geometryA, geometryB)) return [];
            return [normalize(a.id, b.id)];
        }),
    );
}

/** 前フレームの接触集合と今フレームの接触集合を突き合わせて enter/stay/exit を確定させる。 */
export function diffContacts(prev: readonly Contact[], next: readonly Contact[]): CollisionEvents {
    const prevKeys = new Set(prev.map(contactKey));
    const nextKeys = new Set(next.map(contactKey));
    return {
        entered: next.filter((c) => !prevKeys.has(contactKey(c))),
        stayed: next.filter((c) => prevKeys.has(contactKey(c))),
        exited: prev.filter((c) => !nextKeys.has(contactKey(c))),
    };
}
