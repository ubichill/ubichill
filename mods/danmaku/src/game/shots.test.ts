import { describe, expect, it } from 'vitest';
import { circlesOverlap } from './geometry';
import { MAX_STEP_SECONDS, shipControlsOf } from './ship';
import { addShot, MAX_SHOTS, pullTrigger, SHOT_RADIUS, type Shot, shotFrom, stepShots } from './shots';

const area = { x: 0, y: 0, w: 800, h: 600 };
const shot = (x: number, y: number, mine = true): Shot => ({ x, y, vy: -400, mine });

describe('shotFrom（ほかの人から届いた発射も信用しない）', () => {
    it.each([
        ['null', null],
        ['文字列', 'x'],
        ['座標が文字列', { x: '1', y: 2, speed: 3 }],
        ['NaN', { x: Number.NaN, y: 2, speed: 3 }],
        ['Infinity の速さ', { x: 1, y: 2, speed: Number.POSITIVE_INFINITY }],
    ])('%s は捨てる', (_, raw) => {
        expect(shotFrom(raw, false)).toBeNull();
    });

    it('速さは上向きにし、極端な値は収める', () => {
        expect(shotFrom({ x: 1, y: 2, speed: 300 }, true)).toEqual({ x: 1, y: 2, vy: -300, mine: true });
        expect(shotFrom({ x: 1, y: 2, speed: -300 }, true)?.vy).toBe(-50);
        expect(shotFrom({ x: 1, y: 2, speed: 1e9 }, false)?.vy).toBe(-2000);
    });
});

describe('stepShots・addShot', () => {
    const fly = (shots: Shot[], seconds: number) => stepShots(shots, seconds, area, []).shots;

    it('上へ進み、範囲の上を抜けたら消える', () => {
        expect(fly([shot(100, 300)], 0.1)).toEqual([shot(100, 260)]);
        expect(fly([shot(100, 5)], 0.1)).toEqual([]);
    });

    it('大きな経過時間は 1 フレーム分に、負・NaN は 0 にする', () => {
        expect(fly([shot(100, 500)], 60)[0].y).toBeCloseTo(500 - 400 * MAX_STEP_SECONDS);
        expect(fly([shot(100, 500)], -1)[0].y).toBe(500);
        expect(fly([shot(100, 500)], Number.NaN)[0].y).toBe(500);
    });

    it('ためすぎたら古い弾から捨てる', () => {
        const many = Array.from({ length: MAX_SHOTS }, (_, i) => shot(i, 300));
        const next = addShot(many, shot(9999, 300));
        expect(next).toHaveLength(MAX_SHOTS);
        expect(next[0].x).toBe(1);
        expect(next[MAX_SHOTS - 1].x).toBe(9999);
    });
});

describe('stepShots の当たり（その場の重なり）', () => {
    const enemy = { id: 'a', center: { x: 100, y: 100 }, radius: 20 };
    const still = (shots: Shot[], targets = [enemy]) => stepShots(shots, 0, area, targets);

    it('当たった弾は消え、自分の弾だけを数える（ほかの人の弾はその人が数える）', () => {
        const result = still([shot(100, 110, true), shot(105, 95, false), shot(400, 400, true)]);
        expect(result.hits).toEqual({ a: 1 });
        expect(result.shots).toEqual([shot(400, 400, true)]);
        expect(result.impacts.map((i) => i.targetId)).toEqual(['a', 'a']);
    });

    it('重なった 2 体のうち先の 1 体にだけ当たる（1 発で 2 体削らない）', () => {
        const other = { id: 'b', center: { x: 105, y: 100 }, radius: 20 };
        expect(still([shot(102, 100)], [enemy, other]).hits).toEqual({ a: 1 });
    });

    it('的がいなければ何も起きない', () => {
        expect(still([shot(1, 1)], [])).toEqual({ shots: [shot(1, 1)], hits: {}, impacts: [] });
    });

    it('動かない弾（長さ 0）は今の位置だけで見て、ちょうど触れるだけなら当たらない', () => {
        const reach = SHOT_RADIUS + enemy.radius;
        expect(still([shot(100 + reach, 100)]).hits).toEqual({});
        expect(still([shot(100 + reach - 0.01, 100)]).hits).toEqual({ a: 1 });
    });
});

describe('stepShots の当たり（フレームの間の通り道）', () => {
    const FRAME = 0.06;
    const fastest = shotFrom({ x: 100, y: 300, speed: Number.MAX_VALUE }, true) as Shot;
    // 敵の当たりの半径は 6 より小さくならない（enemySpecOf）
    const small = (x: number, y: number) => ({ id: 's', center: { x, y }, radius: 6 });

    it.each([
        ['受け取る弾の上限', fastest],
        ['自機の設定の上限', { ...fastest, vy: -shipControlsOf({ bulletSpeed: Number.MAX_VALUE }).bulletSpeed }],
    ])('%s の速さで 60ms 進む間に、移動の前後の真ん中にいる敵を通り抜けても当たる', (_, fast) => {
        const travel = -fast.vy * FRAME;
        const target = small(100, 300 - travel / 2);
        const moved = { x: 100, y: 300 - travel };
        // 移動後の位置だけで見ると当たらない並び
        expect(circlesOverlap(moved, SHOT_RADIUS, target.center, target.radius)).toBe(false);
        expect(circlesOverlap(fast, SHOT_RADIUS, target.center, target.radius)).toBe(false);
        const result = stepShots([fast], FRAME, area, [target]);
        expect(result.hits).toEqual({ s: 1 });
        expect(result.shots).toEqual([]);
        // 火花は敵の手前の縁（通り過ぎた先ではない）
        expect(result.impacts).toHaveLength(1);
        expect(result.impacts[0]).toMatchObject({ x: 100, targetId: 's' });
        expect(result.impacts[0].y).toBeCloseTo(target.center.y + SHOT_RADIUS + 6);
    });

    it('通り道が半径のわずかに外なら当たらず、ちょうど接するだけでも当たらない', () => {
        const reach = SHOT_RADIUS + 6;
        const at = (dx: number) => stepShots([fastest], FRAME, area, [small(100 + dx, 240)]);
        expect(at(reach - 0.01).hits).toEqual({ s: 1 });
        expect(at(reach).hits).toEqual({});
        expect(at(reach + 0.01).hits).toEqual({});
        expect(at(reach + 0.01).shots).toHaveLength(1);
    });

    it('届かない手前の敵・通り過ぎた後ろの敵には当たらない', () => {
        expect(stepShots([fastest], FRAME, area, [small(100, 300 - 120 - 10)]).hits).toEqual({});
        expect(stepShots([fastest], FRAME, area, [small(100, 300 + 10)]).hits).toEqual({});
    });

    it('通り道に 2 体いれば、並びの順でなく手前の敵に当たる', () => {
        const far = { ...small(100, 200), id: 'far' };
        const near = { ...small(100, 260), id: 'near' };
        expect(stepShots([fastest], FRAME, area, [far, near]).hits).toEqual({ near: 1 });
    });

    it('範囲の上端の近くで敵を通り抜けて範囲の外へ出る弾も、消す前に当たりを見る', () => {
        const top = shotFrom({ x: 100, y: 40, speed: Number.MAX_VALUE }, true) as Shot;
        const result = stepShots([top], FRAME, area, [small(100, 10)]);
        expect(result.hits).toEqual({ s: 1 });
        expect(stepShots([top], FRAME, area, []).shots).toEqual([]);
    });

    it('横切っていく敵とは、敵から見た弾の動きで見る', () => {
        // 敵は弾の線を左から右へ横切る。移動後の敵の位置だけでは弾の線から 20 離れている
        const crossing = { id: 'c', from: { x: 80, y: 240 }, center: { x: 120, y: 240 }, radius: 6 };
        expect(stepShots([fastest], FRAME, area, [crossing]).hits).toEqual({ c: 1 });
        expect(stepShots([fastest], FRAME, area, [{ ...crossing, from: crossing.center }]).hits).toEqual({});
    });
});

describe('pullTrigger', () => {
    it('押した瞬間に撃ち、rate 発/秒の間隔で撃ち続ける', () => {
        const first = pullTrigger(0, 0.016, true, 10);
        expect(first).toEqual({ fire: true, cooldown: 0.1 });
        const frames = Array.from({ length: 60 }).reduce<{ cooldown: number; shots: number }>(
            (acc) => {
                const next = pullTrigger(acc.cooldown, 1 / 60, true, 10);
                return { cooldown: next.cooldown, shots: acc.shots + (next.fire ? 1 : 0) };
            },
            { cooldown: 0, shots: 0 },
        );
        expect(frames.shots).toBeGreaterThanOrEqual(9);
        expect(frames.shots).toBeLessThanOrEqual(11);
    });

    it('離している間も次の発射までの時間は減り、rate が 0・NaN でも壊れない', () => {
        expect(pullTrigger(0.1, 0.05, false, 10)).toEqual({ fire: false, cooldown: 0.05 });
        expect(pullTrigger(0, 0.016, true, 0).cooldown).toBe(10);
        expect(Number.isFinite(pullTrigger(0, 0.016, true, Number.NaN).cooldown)).toBe(true);
    });
});
