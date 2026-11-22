/**
 * 敵の弾。弾は持ち回らず「何回目の発射の何発目か」と時刻から位置を求める。
 * そのため全員が同じ弾を見られ、時刻が飛んでも戻っても弾がたまらない。
 * 狙い撃ち（aimed）の向きだけは自機の位置で決まるので、呼び出し側が aim で渡す。
 */

import { activeFrom, type BulletPattern, type EnemySpec, enemyPosition, FIRST_VOLLEY_DELAY } from './enemy';
import { distanceSq, type Rect, rectContains, type Vec } from './geometry';

export const BULLET_HIT_RADIUS = 4;
export const DOWNWARD = Math.PI / 2;

/** 弾は範囲から少し出たところで消す。 */
const AREA_MARGIN = 12;
/** 範囲の外にいる敵が撃った弾も、範囲を横切るまでは追う。 */
const ORIGIN_SLACK = 400;
/** 1 体が同時に出せる弾の上限（設定を極端にしても 1 フレームの計算が止まらないように）。 */
export const MAX_VOLLEYS_PER_ENEMY = 120;
export const MAX_BULLETS_PER_ENEMY = 400;

const RAIN_MIN_SPEED = 0.7;
const RAIN_SPEED_RANGE = 0.6;

export interface EnemyBullet {
    readonly x: number;
    readonly y: number;
    readonly enemyId: string;
    readonly color: string;
}

export interface BulletDirection {
    readonly angle: number;
    readonly speedScale: number;
}

/** 狙い撃ちの向き（ラジアン）。key は敵と発射の回で決まり、同じ回には同じ向きを返すこと。 */
export type AimFn = (key: string, origin: Vec, firedAt: number) => number;

export function hashString(text: string): number {
    return [...text].reduce((h, ch) => Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0, 0x811c9dc5);
}

/** 整数の組から [0, 1) の値を決める（全クライアントで同じ値になる乱数の代わり）。 */
export function hash01(seed: number, ...values: readonly number[]): number {
    const mixed = values.reduce((acc, n) => {
        const x = Math.imul(acc ^ (n | 0), 0x27d4eb2d) >>> 0;
        return (x ^ (x >>> 15)) >>> 0;
    }, seed >>> 0);
    const f = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
    return ((f ^ (f >>> 13)) >>> 0) / 4294967296;
}

export function volleyTime(spec: EnemySpec, volley: number): number {
    return activeFrom(spec) + FIRST_VOLLEY_DELAY + volley * spec.interval;
}

export function volleyKey(spec: EnemySpec, volley: number): string {
    return `${spec.id}#${volley}`;
}

const evenly = (count: number, base: number): BulletDirection[] =>
    Array.from({ length: count }, (_, i) => ({ angle: base + (2 * Math.PI * i) / count, speedScale: 1 }));

const byPattern: Record<BulletPattern, (spec: EnemySpec, volley: number, aim: number) => BulletDirection[]> = {
    // 回ごとに半分ずらし、同じ場所に隙間ができ続けないようにする
    radial: (spec, volley) => evenly(spec.count, DOWNWARD + ((volley % 2) * Math.PI) / spec.count),
    spiral: (spec, volley) => evenly(spec.count, DOWNWARD + volley * spec.spread),
    aimed: (spec, _volley, aim) =>
        spec.count === 1
            ? [{ angle: aim, speedScale: 1 }]
            : Array.from({ length: spec.count }, (_, i) => ({
                  angle: aim - spec.spread / 2 + (spec.spread * i) / (spec.count - 1),
                  speedScale: 1,
              })),
    rain: (spec, volley) => {
        const seed = hashString(spec.id);
        return Array.from({ length: spec.count }, (_, i) => ({
            angle: DOWNWARD + (hash01(seed, volley, i, 0) - 0.5) * spec.spread,
            speedScale: RAIN_MIN_SPEED + RAIN_SPEED_RANGE * hash01(seed, volley, i, 1),
        }));
    },
};

export function volleyDirections(spec: EnemySpec, volley: number, aim: number): BulletDirection[] {
    return byPattern[spec.pattern](spec, volley, aim);
}

/** time 時点で、まだ範囲の中に弾が残り得る発射の回（新しい順）。 */
export function liveVolleys(spec: EnemySpec, t: number, area: Rect): number[] {
    const first = volleyTime(spec, 0);
    if (!(t >= first)) return [];
    const slowest = spec.bulletSpeed * (spec.pattern === 'rain' ? RAIN_MIN_SPEED : 1);
    const lifetime = (Math.hypot(area.w, area.h) + 2 * AREA_MARGIN + ORIGIN_SLACK) / slowest;
    const newest = Math.floor((t - first) / spec.interval);
    const oldest = Math.max(0, Math.ceil((t - lifetime - first) / spec.interval), newest - MAX_VOLLEYS_PER_ENEMY + 1);
    return Array.from({ length: Math.max(0, newest - oldest + 1) }, (_, i) => newest - i).filter(
        (volley) => spec.leaveAt === null || volleyTime(spec, volley) < spec.leaveAt,
    );
}

export function enemyBullets(spec: EnemySpec, t: number, area: Rect, aim: AimFn): EnemyBullet[] {
    return liveVolleys(spec, t, area)
        .flatMap((volley) => {
            const firedAt = volleyTime(spec, volley);
            const origin = enemyPosition(spec, firedAt);
            const travel = spec.bulletSpeed * (t - firedAt);
            const angle = spec.pattern === 'aimed' ? aim(volleyKey(spec, volley), origin, firedAt) : DOWNWARD;
            return volleyDirections(spec, volley, angle).map((dir) => ({
                x: origin.x + Math.cos(dir.angle) * travel * dir.speedScale,
                y: origin.y + Math.sin(dir.angle) * travel * dir.speedScale,
                enemyId: spec.id,
                color: spec.color,
            }));
        })
        .filter((bullet) => rectContains(area, bullet, AREA_MARGIN))
        .slice(0, MAX_BULLETS_PER_ENEMY);
}

/** origin から一番近い的への向き。的がいなければ真下。 */
export function aimToward(origin: Vec, targets: readonly Vec[]): number {
    const nearest = targets.reduce<Vec | null>(
        (best, target) => (best === null || distanceSq(target, origin) < distanceSq(best, origin) ? target : best),
        null,
    );
    if (nearest === null || (nearest.x === origin.x && nearest.y === origin.y)) return DOWNWARD;
    return Math.atan2(nearest.y - origin.y, nearest.x - origin.x);
}

/** 発射した直後だけ狙いを決める。それより古い回（後から部屋に入ったときなど）は真下に撃ったことにする。 */
export const AIM_FRESH_SECONDS = 0.25;

export interface AimMemory {
    readonly aim: AimFn;
    /** このフレームで使わなかった回の狙いを忘れる（範囲から出た弾の分がたまらない）。 */
    readonly forgetUnused: () => void;
}

/**
 * 狙いを回ごとに 1 回だけ決めて覚える。弾が飛んでいる間に自機が動いても、向きは変わらない。
 * memory はフレームをまたいで同じものを渡す。
 */
export function rememberAims(memory: Map<string, number>, targets: readonly Vec[], t: number): AimMemory {
    const used = new Set<string>();
    return {
        aim: (key, origin, firedAt) => {
            used.add(key);
            const known = memory.get(key);
            if (known !== undefined) return known;
            const angle = t - firedAt <= AIM_FRESH_SECONDS ? aimToward(origin, targets) : DOWNWARD;
            memory.set(key, angle);
            return angle;
        },
        forgetUnused: () => {
            for (const key of [...memory.keys()]) if (!used.has(key)) memory.delete(key);
        },
    };
}
