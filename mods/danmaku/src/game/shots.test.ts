import { describe, expect, it } from 'vitest';
import { MAX_STEP_SECONDS } from './ship';
import { addShot, MAX_SHOTS, pullTrigger, resolveShots, type Shot, shotFrom, stepShots } from './shots';

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
    it('上へ進み、範囲の上を抜けたら消える', () => {
        expect(stepShots([shot(100, 300)], 0.1, area)).toEqual([shot(100, 260)]);
        expect(stepShots([shot(100, 5)], 0.1, area)).toEqual([]);
    });

    it('大きな経過時間は 1 フレーム分に、負・NaN は 0 にする', () => {
        expect(stepShots([shot(100, 500)], 60, area)[0].y).toBeCloseTo(500 - 400 * MAX_STEP_SECONDS);
        expect(stepShots([shot(100, 500)], -1, area)[0].y).toBe(500);
        expect(stepShots([shot(100, 500)], Number.NaN, area)[0].y).toBe(500);
    });

    it('ためすぎたら古い弾から捨てる', () => {
        const many = Array.from({ length: MAX_SHOTS }, (_, i) => shot(i, 300));
        const next = addShot(many, shot(9999, 300));
        expect(next).toHaveLength(MAX_SHOTS);
        expect(next[0].x).toBe(1);
        expect(next[MAX_SHOTS - 1].x).toBe(9999);
    });
});

describe('resolveShots', () => {
    const enemy = { id: 'a', center: { x: 100, y: 100 }, radius: 20 };

    it('当たった弾は消え、自分の弾だけを数える（ほかの人の弾はその人が数える）', () => {
        const result = resolveShots([shot(100, 110, true), shot(105, 95, false), shot(400, 400, true)], [enemy]);
        expect(result.hits).toEqual({ a: 1 });
        expect(result.shots).toEqual([shot(400, 400, true)]);
        expect(result.impacts.map((i) => i.targetId)).toEqual(['a', 'a']);
    });

    it('重なった 2 体のうち先の 1 体にだけ当たる（1 発で 2 体削らない）', () => {
        const other = { id: 'b', center: { x: 105, y: 100 }, radius: 20 };
        expect(resolveShots([shot(102, 100)], [enemy, other]).hits).toEqual({ a: 1 });
    });

    it('的がいなければ何も起きない', () => {
        expect(resolveShots([shot(1, 1)], [])).toEqual({ shots: [shot(1, 1)], hits: {}, impacts: [] });
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
