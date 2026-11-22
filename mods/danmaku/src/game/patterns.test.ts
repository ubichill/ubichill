import { describe, expect, it } from 'vitest';
import { type EnemySpec, enemySpecOf } from './enemy';
import {
    AIM_FRESH_SECONDS,
    aimToward,
    DOWNWARD,
    enemyBullets,
    liveVolleys,
    MAX_BULLETS_PER_ENEMY,
    MAX_VOLLEYS_PER_ENEMY,
    rememberAims,
    volleyDirections,
    volleyTime,
} from './patterns';

const area = { x: 0, y: 0, w: 800, h: 600 };
const spec = (data: Record<string, unknown>, id = 'e1'): EnemySpec =>
    enemySpecOf({ id, transform: { x: 380, y: 130, w: 40, h: 40 }, data: { motion: 'none', ...data } });
const down = (): number => DOWNWARD;
const normalize = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

describe('volleyDirections', () => {
    it('radial: 等間隔の輪で、偶数回は真下に 1 発、奇数回は半分ずらす', () => {
        const s = spec({ pattern: 'radial', count: 8 });
        const even = volleyDirections(s, 0, 0).map((d) => normalize(d.angle));
        expect(even).toContainEqual(expect.closeTo(DOWNWARD, 9));
        expect(normalize(even[1] - even[0])).toBeCloseTo(Math.PI / 4);
        const odd = volleyDirections(s, 1, 0).map((d) => normalize(d.angle));
        expect(normalize(odd[0] - even[0])).toBeCloseTo(Math.PI / 8);
    });

    it('spiral: 回ごとに spread だけ回る', () => {
        const s = spec({ pattern: 'spiral', count: 3, spread: 10 });
        const a = volleyDirections(s, 4, 0)[0].angle;
        const b = volleyDirections(s, 5, 0)[0].angle;
        expect(b - a).toBeCloseTo((10 * Math.PI) / 180);
    });

    it('aimed: 狙った向きを中心に広げ、1 発なら狙った向きそのもの', () => {
        const fan = volleyDirections(spec({ pattern: 'aimed', count: 5, spread: 40 }), 0, 1).map((d) => d.angle);
        expect(fan[2]).toBeCloseTo(1);
        expect(fan[4] - fan[0]).toBeCloseTo((40 * Math.PI) / 180);
        expect(volleyDirections(spec({ pattern: 'aimed', count: 1, spread: 90 }), 0, 1.23)[0].angle).toBe(1.23);
    });

    it('aimed: 広さ 0 なら全部同じ向き（0 で割らない）', () => {
        const angles = volleyDirections(spec({ pattern: 'aimed', count: 4, spread: 0 }), 0, 0.5).map((d) => d.angle);
        expect(angles.every((a) => a === 0.5)).toBe(true);
    });

    it('rain: 真下から spread の範囲にばらけ、速さもばらけ、どの画面でも同じ並びになる', () => {
        const s = spec({ pattern: 'rain', count: 50, spread: 60 });
        const dirs = volleyDirections(s, 7, 0);
        const half = (60 * Math.PI) / 360;
        expect(dirs.every((d) => Math.abs(d.angle - DOWNWARD) <= half + 1e-9)).toBe(true);
        expect(dirs.every((d) => d.speedScale >= 0.7 && d.speedScale < 1.3)).toBe(true);
        expect(new Set(dirs.map((d) => d.angle.toFixed(4))).size).toBeGreaterThan(40);
        expect(volleyDirections(s, 7, 0)).toEqual(dirs);
        expect(volleyDirections(spec({ pattern: 'rain', count: 50, spread: 60 }, 'e2'), 7, 0)).not.toEqual(dirs);
    });
});

describe('liveVolleys', () => {
    const s = spec({ pattern: 'radial', interval: 0.5, appearAt: 1, leaveAt: 10 });

    it('最初の発射より前・NaN の時刻では撃っていない', () => {
        expect(liveVolleys(s, volleyTime(s, 0) - 0.001, area)).toEqual([]);
        expect(liveVolleys(s, Number.NaN, area)).toEqual([]);
        expect(liveVolleys(s, volleyTime(s, 0), area)).toEqual([0]);
    });

    it('去る時刻ちょうど以降には撃たない', () => {
        const volleys = liveVolleys(s, 10.2, area);
        expect(volleys.every((v) => volleyTime(s, v) < 10)).toBe(true);
    });

    it('ずっと先の時刻でも回の数には上限があり、計算が止まらない', () => {
        const dense = spec({ pattern: 'radial', interval: 0.05, bulletSpeed: 20 });
        const volleys = liveVolleys(dense, 1e7, area);
        expect(volleys.length).toBeGreaterThan(0);
        expect(volleys.length).toBeLessThanOrEqual(MAX_VOLLEYS_PER_ENEMY);
        expect(volleys[0]).toBeGreaterThan(volleys[volleys.length - 1]);
    });
});

describe('enemyBullets', () => {
    it('同じ時刻なら同じ弾（時刻が戻ってから進み直しても弾がたまらない）', () => {
        const s = spec({ pattern: 'spiral', count: 4, interval: 0.1, spread: 12 });
        const at30 = enemyBullets(s, 30, area, down);
        enemyBullets(s, 12, area, down);
        enemyBullets(s, 31, area, down);
        expect(enemyBullets(s, 30, area, down)).toEqual(at30);
    });

    it('弾は範囲の少し外までしか残らず、1 体の弾の数には上限がある', () => {
        const s = spec({ pattern: 'radial', count: 64, interval: 0.05, bulletSpeed: 20 });
        const bullets = enemyBullets(s, 500, area, down);
        expect(bullets.length).toBeLessThanOrEqual(MAX_BULLETS_PER_ENEMY);
        expect(bullets.every((b) => b.x >= -12 && b.x <= 812 && b.y >= -12 && b.y <= 612)).toBe(true);
    });

    it('弾は時間とともに敵から離れていく', () => {
        const s = spec({ pattern: 'radial', count: 8, interval: 100 });
        const t0 = volleyTime(s, 0);
        const dist = (t: number) =>
            Math.max(...enemyBullets(s, t, area, down).map((b) => Math.hypot(b.x - s.home.x, b.y - s.home.y)));
        expect(dist(t0 + 1)).toBeCloseTo(s.bulletSpeed);
        expect(dist(t0 + 2)).toBeCloseTo(2 * s.bulletSpeed);
    });

    it('前のフレームの時刻からの通り道を持ち、その間に撃った弾は撃った位置から通ったことにする', () => {
        const s = spec({ pattern: 'radial', count: 1, interval: 100, bulletSpeed: 600 });
        const t0 = volleyTime(s, 0);
        const [flying] = enemyBullets(s, t0 + 0.5, area, down, t0 + 0.44);
        expect(flying.y - flying.from.y).toBeCloseTo(600 * 0.06);
        const [fresh] = enemyBullets(s, t0 + 0.03, area, down, t0 - 0.03);
        expect(fresh.from).toEqual(s.home);
        expect(fresh.y - s.home.y).toBeCloseTo(600 * 0.03);
    });

    it('このフレームで範囲の外へ抜けた弾も、当たりを見るために残す', () => {
        const s = spec({ pattern: 'radial', count: 1, interval: 100, bulletSpeed: 600 });
        const t = volleyTime(s, 0) + (600 - s.home.y + 20) / 600;
        expect(enemyBullets(s, t, area, down)).toEqual([]);
        expect(enemyBullets(s, t, area, down, t - 0.06)).toHaveLength(1);
    });

    it('狙い撃ちは回ごとに 1 つの key で向きを聞く', () => {
        const s = spec({ pattern: 'aimed', count: 3, interval: 1 });
        const keys: string[] = [];
        enemyBullets(s, volleyTime(s, 2) + 0.1, area, (key) => {
            keys.push(key);
            return DOWNWARD;
        });
        expect(keys).toEqual(['e1#2', 'e1#1', 'e1#0']);
    });
});

describe('狙い', () => {
    it('一番近い的を狙い、的がいない・真上に重なっているときは真下', () => {
        expect(aimToward({ x: 0, y: 0 }, [])).toBe(DOWNWARD);
        expect(aimToward({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(DOWNWARD);
        expect(
            aimToward({ x: 0, y: 0 }, [
                { x: 100, y: 0 },
                { x: 0, y: -10 },
            ]),
        ).toBeCloseTo(-Math.PI / 2);
    });

    it('撃った直後の回だけ自機を狙い、一度決めた向きは自機が動いても変えない', () => {
        const memory = new Map<string, number>();
        const first = rememberAims(memory, [{ x: 100, y: 0 }], 10);
        expect(first.aim('e#1', { x: 0, y: 0 }, 10)).toBeCloseTo(0);
        const later = rememberAims(memory, [{ x: -100, y: 0 }], 11);
        expect(later.aim('e#1', { x: 0, y: 0 }, 10)).toBeCloseTo(0);
    });

    it('見ていなかった古い回（後から部屋に入った等）は真下に撃ったことにする', () => {
        const memory = new Map<string, number>();
        const aims = rememberAims(memory, [{ x: 100, y: 0 }], 10);
        expect(aims.aim('e#1', { x: 0, y: 0 }, 10 - AIM_FRESH_SECONDS - 0.01)).toBe(DOWNWARD);
    });

    it('このフレームで使わなかった回は忘れる', () => {
        const memory = new Map<string, number>([
            ['old', 1],
            ['keep', 2],
        ]);
        const aims = rememberAims(memory, [], 0);
        aims.aim('keep', { x: 0, y: 0 }, 0);
        aims.forgetUnused();
        expect([...memory.keys()]).toEqual(['keep']);
    });
});
