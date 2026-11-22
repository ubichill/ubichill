/**
 * 自機の弾。撃った人の画面でだけ当たりを数え（mine）、ほかの人の弾は見た目として飛ばすだけにする。
 * 同じ当たりを 2 人が数えないため。
 */

import { circlesOverlap, clamp, type Rect, rectContains, type Vec } from './geometry';
import { MAX_STEP_SECONDS } from './ship';

export interface Shot {
    readonly x: number;
    readonly y: number;
    /** px/秒。上向きは負。 */
    readonly vy: number;
    readonly mine: boolean;
}

export interface ShotTarget {
    readonly id: string;
    readonly center: Vec;
    readonly radius: number;
}

export interface Impact extends Vec {
    readonly targetId: string;
}

export interface ShotResult {
    readonly shots: Shot[];
    /** 自分の弾が当たった数（敵ごと）。 */
    readonly hits: Readonly<Record<string, number>>;
    /** 当たった場所と相手（自分の弾もほかの人の弾も）。 */
    readonly impacts: Impact[];
}

export const SHOT_RADIUS = 3;
/** 受け取った弾をためすぎない（ほかの人から大量に届いても重くならない）。 */
export const MAX_SHOTS = 300;
const SHOT_SPEED_RANGE = { min: 50, max: 2000 } as const;
const CULL_MARGIN = 24;

/** 届いた発射（ほかの人からのものを含む）を読む。数でない値は捨てる。 */
export function shotFrom(raw: unknown, mine: boolean): Shot | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const { x, y, speed } = raw as { x?: unknown; y?: unknown; speed?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || typeof speed !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(speed)) return null;
    return { x, y, vy: -clamp(speed, SHOT_SPEED_RANGE.min, SHOT_SPEED_RANGE.max), mine };
}

export function addShot(shots: readonly Shot[], shot: Shot): Shot[] {
    return [...shots, shot].slice(-MAX_SHOTS);
}

export function stepShots(shots: readonly Shot[], seconds: number, area: Rect): Shot[] {
    const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, MAX_STEP_SECONDS);
    return shots
        .map((shot) => ({ ...shot, y: shot.y + shot.vy * dt }))
        .filter((shot) => rectContains(area, shot, CULL_MARGIN));
}

const countIds = (ids: readonly string[]): Record<string, number> =>
    Object.fromEntries([...new Set(ids)].map((id) => [id, ids.filter((other) => other === id).length]));

/** 弾は最初に重なった的に当たって消える。 */
export function resolveShots(shots: readonly Shot[], targets: readonly ShotTarget[]): ShotResult {
    const matched = shots.map((shot) => ({
        shot,
        target: targets.find((t) => circlesOverlap(shot, SHOT_RADIUS, t.center, t.radius)),
    }));
    return {
        shots: matched.flatMap(({ shot, target }) => (target ? [] : [shot])),
        hits: countIds(matched.flatMap(({ shot, target }) => (target && shot.mine ? [target.id] : []))),
        impacts: matched.flatMap(({ shot, target }) => (target ? [{ x: shot.x, y: shot.y, targetId: target.id }] : [])),
    };
}

export interface Trigger {
    readonly fire: boolean;
    readonly cooldown: number;
}

/** 連射の間隔。押している間、rate 発/秒で撃つ。 */
export function pullTrigger(cooldown: number, seconds: number, wantsFire: boolean, rate: number): Trigger {
    const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, MAX_STEP_SECONDS);
    const remaining = Math.max(0, cooldown - dt);
    if (!wantsFire || remaining > 0) return { fire: false, cooldown: remaining };
    return { fire: true, cooldown: 1 / clamp(Number.isFinite(rate) ? rate : 1, 0.1, 60) };
}
