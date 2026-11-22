/**
 * 範囲（danmaku:canvas）の 1 フレーム。敵の位置・弾・自機の被弾・自機の弾の当たり・撃破をまとめて決める。
 * 入力だけから決まり、部屋への書き込みや描画はしない（Worker が結果を使う）。
 */

import { type Body, shipIsHit } from './area';
import { type EnemySpec, enemyPhase, enemyPosition, isOnStage } from './enemy';
import { type Motion, pointAlong, type Rect, still, type Vec } from './geometry';
import { type AimFn, bulletInArea, type EnemyBullet, enemyBullets } from './patterns';
import { type Impact, type Shot, stepShots } from './shots';
import { type Hits, isDefeated, mergeHits } from './stage';

export interface FrameShip {
    readonly center: Vec;
    /** previousTime の時点の中心。省略すると、その間は止まっていたとみなす。 */
    readonly from?: Vec;
    readonly hitRadius: number;
    readonly vulnerable: boolean;
}

export interface FrameInput {
    /** ラウンドの経過秒。始まっていなければ null（敵も弾も出さない）。 */
    readonly stageTime: number | null;
    /** 前のフレームのラウンドの経過秒（無ければ null）。敵・弾・自機は、ここから今までに動いた線分で当たりを見る。 */
    readonly previousTime: number | null;
    /** 前のフレームからの秒（自機の弾を進める）。 */
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

/**
 * 当たりを線分で見るのは、前のフレームから今まで。ただし最後のこの秒まで（タブを戻した直後など、
 * 止まっていた間に自機の場所を通った弾にまとめて当たらないように）。
 */
export const MAX_SWEEP_SECONDS = 0.25;

/** 当たりを線分で見る始まりの時刻。前のフレームが無い・時刻が戻ったときは今だけを見る。 */
export function sweepSince(t: number, previous: number | null): number {
    if (previous === null || !(previous <= t)) return t;
    return Math.max(previous, t - MAX_SWEEP_SECONDS);
}

/** 自機の previous から今までの動きのうち、since から後の分（まっすぐ動いたとみなす）。弾と同じ間を見る。 */
function shipMotion(ship: FrameShip, t: number, previous: number | null, since: number): Motion {
    if (previous === null || !(previous < t)) return still(ship.center);
    const path = { from: ship.from ?? ship.center, to: ship.center };
    return { from: pointAlong(path, (since - previous) / (t - previous)), to: ship.center };
}

export function stepFrame(input: FrameInput): FrameResult {
    const t = input.stageTime;
    const since = t === null ? t : sweepSince(t, input.previousTime);
    const fighting = input.enemies.filter((spec) => !isDefeated(spec, input.hits));
    const onStage =
        t === null
            ? []
            : fighting
                  .filter((spec) => isOnStage(enemyPhase(spec, t)))
                  .map((spec) => ({ spec, position: enemyPosition(spec, t) }));
    const bullets =
        t === null || since === null
            ? []
            : fighting.flatMap((spec) => enemyBullets(spec, t, input.area, input.aim, since));
    const ship = input.ship;
    const shipHit =
        t !== null &&
        since !== null &&
        ship?.vulnerable === true &&
        shipIsHit(shipMotion(ship, t, input.previousTime, since), ship.hitRadius, bullets, bodiesOf(onStage));

    const targets = onStage.map(({ spec, position }) => ({
        id: spec.id,
        center: position,
        from: since === null ? position : enemyPosition(spec, since),
        radius: spec.radius,
    }));
    const resolved = stepShots(input.shots, input.seconds, input.area, targets);
    const hits = mergeHits(input.hits, resolved.hits);
    const fallen = new Set(input.enemies.filter((spec) => isDefeated(spec, hits)).map((spec) => spec.id));
    const enemies = onStage.filter(({ spec }) => !fallen.has(spec.id));
    return {
        enemies,
        bullets: bullets.filter((bullet) => !fallen.has(bullet.enemyId) && bulletInArea(bullet, input.area)),
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
