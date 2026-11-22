/**
 * 自機の弾。撃った人の画面でだけ当たりを数え（mine）、ほかの人の弾は見た目として飛ばすだけにする。
 * 同じ当たりを 2 人が数えないため。
 */

import { clamp, type Motion, pointAlong, type Rect, rectContains, sweptContact, type Vec } from './geometry';
import { stepSeconds } from './ship';

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
    /** フレームの始めの中心。省略すると、このフレームの間は止まっていたとみなす。 */
    readonly from?: Vec;
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

const countIds = (ids: readonly string[]): Record<string, number> =>
    Object.fromEntries([...new Set(ids)].map((id) => [id, ids.filter((other) => other === id).length]));

/** 通り道で最初に触れた的と、触れた位置。重なった的が同時なら先に並んだ方。 */
function firstImpact(path: Motion, targets: readonly ShotTarget[]): Impact | null {
    const first = targets.reduce<{ target: ShotTarget; time: number } | null>((best, target) => {
        const time = sweptContact(
            path,
            { from: target.from ?? target.center, to: target.center },
            SHOT_RADIUS + target.radius,
        );
        return time !== null && (best === null || time < best.time) ? { target, time } : best;
    }, null);
    return first ? { ...pointAlong(path, first.time), targetId: first.target.id } : null;
}

/**
 * 弾を 1 フレーム分進め、進む前から後までの線分で当たりを見る（速い弾がフレームの間に的を通り抜けても当たる）。
 * 弾は最初に触れた的に当たって消える。当たらずに範囲の外へ出た弾も消す（当たりを見てから消す）。
 */
export function stepShots(
    shots: readonly Shot[],
    seconds: number,
    area: Rect,
    targets: readonly ShotTarget[],
): ShotResult {
    const dt = stepSeconds(seconds);
    const flown = shots.map((shot) => {
        const moved = { ...shot, y: shot.y + shot.vy * dt };
        return { moved, impact: firstImpact({ from: shot, to: moved }, targets) };
    });
    return {
        shots: flown.flatMap(({ moved, impact }) =>
            impact === null && rectContains(area, moved, CULL_MARGIN) ? [moved] : [],
        ),
        hits: countIds(flown.flatMap(({ moved, impact }) => (impact && moved.mine ? [impact.targetId] : []))),
        impacts: flown.flatMap(({ impact }) => (impact ? [impact] : [])),
    };
}

export interface Trigger {
    readonly fire: boolean;
    readonly cooldown: number;
}

/** 連射の間隔。押している間、rate 発/秒で撃つ。 */
export function pullTrigger(cooldown: number, seconds: number, wantsFire: boolean, rate: number): Trigger {
    const remaining = Math.max(0, cooldown - stepSeconds(seconds));
    if (!wantsFire || remaining > 0) return { fire: false, cooldown: remaining };
    return { fire: true, cooldown: 1 / clamp(Number.isFinite(rate) ? rate : 1, 0.1, 60) };
}
