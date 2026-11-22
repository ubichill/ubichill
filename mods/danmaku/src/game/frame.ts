/**
 * 範囲（danmaku:canvas）の 1 フレーム。敵の位置・弾・自機の被弾・自機の弾の当たり・撃破をまとめて決める。
 * 入力だけから決まり、部屋への書き込みや描画はしない（Worker が結果を使う）。
 */

import { type Body, shipIsHit } from './area';
import { type EnemySpec, enemyPhase, enemyPosition, isOnStage } from './enemy';
import type { Rect, Vec } from './geometry';
import { type AimFn, type EnemyBullet, enemyBullets } from './patterns';
import { type Impact, resolveShots, type Shot, stepShots } from './shots';
import { type Hits, isDefeated, mergeHits } from './stage';

export interface FrameShip {
    readonly center: Vec;
    readonly hitRadius: number;
    readonly vulnerable: boolean;
}

export interface FrameInput {
    /** ラウンドの経過秒。始まっていなければ null（敵も弾も出さない）。 */
    readonly stageTime: number | null;
    /** 前のフレームからの秒。 */
    readonly seconds: number;
    readonly area: Rect;
    readonly enemies: readonly EnemySpec[];
    /** このフレームの前までに分かっているダメージ（全員分）。 */
    readonly hits: Hits;
    /** この画面の人が乗っている自機。 */
    readonly ship: FrameShip | null;
    readonly shots: readonly Shot[];
    readonly aim: AimFn;
    /** 前のフレームで画面に出ていて生きていた敵。撃破の演出を出すのに使う。 */
    readonly wasAlive: ReadonlySet<string>;
}

export interface PlacedEnemy {
    readonly spec: EnemySpec;
    readonly position: Vec;
}

export interface FrameResult {
    /** 画面に出ていて生きている敵。 */
    readonly enemies: PlacedEnemy[];
    /** 生きている敵の弾（倒した敵の弾はその場で消す）。 */
    readonly bullets: EnemyBullet[];
    readonly shipHit: boolean;
    /** このフレームで自分の弾が与えたダメージ。 */
    readonly myHits: Hits;
    readonly hits: Hits;
    readonly shots: Shot[];
    readonly impacts: Impact[];
    /** このフレームで倒れた敵（ほかの人が倒したものも）。 */
    readonly defeated: PlacedEnemy[];
    readonly alive: Set<string>;
}

const bodiesOf = (enemies: readonly PlacedEnemy[]): Body[] =>
    enemies.map(({ spec, position }) => ({ center: position, radius: spec.radius }));

export function stepFrame(input: FrameInput): FrameResult {
    const t = input.stageTime;
    const fighting = input.enemies.filter((spec) => !isDefeated(spec, input.hits));
    const onStage =
        t === null
            ? []
            : fighting
                  .filter((spec) => isOnStage(enemyPhase(spec, t)))
                  .map((spec) => ({ spec, position: enemyPosition(spec, t) }));
    const bullets = t === null ? [] : fighting.flatMap((spec) => enemyBullets(spec, t, input.area, input.aim));
    const ship = input.ship;
    const shipHit = ship?.vulnerable === true && shipIsHit(ship.center, ship.hitRadius, bullets, bodiesOf(onStage));

    const resolved = resolveShots(
        stepShots(input.shots, input.seconds, input.area),
        onStage.map(({ spec, position }) => ({ id: spec.id, center: position, radius: spec.radius })),
    );
    const hits = mergeHits(input.hits, resolved.hits);
    const fallen = new Set(input.enemies.filter((spec) => isDefeated(spec, hits)).map((spec) => spec.id));
    const enemies = onStage.filter(({ spec }) => !fallen.has(spec.id));
    return {
        enemies,
        bullets: bullets.filter((bullet) => !fallen.has(bullet.enemyId)),
        shipHit,
        myHits: resolved.hits,
        hits,
        shots: resolved.shots,
        impacts: resolved.impacts,
        defeated:
            t === null
                ? []
                : input.enemies
                      .filter((spec) => input.wasAlive.has(spec.id) && fallen.has(spec.id))
                      .map((spec) => ({ spec, position: enemyPosition(spec, t) })),
        alive: new Set(enemies.map(({ spec }) => spec.id)),
    };
}
