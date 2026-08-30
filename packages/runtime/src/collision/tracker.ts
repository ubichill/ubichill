/**
 * 接触の追跡（前フレームの接触集合だけを持つ最小の状態）。
 *
 * 判定そのものは `contacts.ts` の純関数が担い、ここは「前回どうだったか」を覚えるためだけに
 * 存在する。状態をこの一点に閉じ込めることで、シミュレーションの再現性を保ったまま
 * enter/exit という時間差のある概念を扱える。
 */

import { type ColliderInstance, type CollisionEvents, type Contact, detectContacts, diffContacts } from './contacts.js';

export interface CollisionTracker {
    /**
     * 1 フレーム進める。渡された Collider 群から接触を求め、前回との差分を返す。
     * 同じ入力を続けて渡せば 2 回目以降は `stayed` だけになる。
     */
    step(colliders: readonly ColliderInstance[]): CollisionEvents;
    /** 現在接触している組（デバッグ・検証用）。 */
    current(): readonly Contact[];
    /** ワールド切り替えなどで履歴を捨てる。次の step は全て `entered` になる。 */
    reset(): void;
}

export function createCollisionTracker(): CollisionTracker {
    // 唯一の可変状態。前フレームの接触集合をここだけに閉じ込める。
    const state: { previous: readonly Contact[] } = { previous: [] };

    return {
        step(colliders) {
            const next = detectContacts(colliders);
            const events = diffContacts(state.previous, next);
            state.previous = next;
            return events;
        },
        current() {
            return state.previous;
        },
        reset() {
            state.previous = [];
        },
    };
}
