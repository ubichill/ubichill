import { describe, expect, it } from 'vitest';
import {
    activeFrom,
    ENTRY_DISTANCE,
    ENTRY_SECONDS,
    type EnemySpec,
    EXIT_SECONDS,
    enemyPhase,
    enemyPosition,
    enemySpecOf,
    isOnStage,
} from './enemy';

const spec = (data: Record<string, unknown>, transform = { x: 80, y: 80, w: 40, h: 40 }): EnemySpec =>
    enemySpecOf({ id: 'e1', transform, data });

describe('enemySpecOf', () => {
    it('data が空でも遊べる既定値になり、位置は Entity の矩形の中心', () => {
        const s = spec({});
        expect(s).toMatchObject({ hp: 20, appearAt: 0, leaveAt: null, motion: 'sway', pattern: 'radial', count: 12 });
        expect(s.home).toEqual({ x: 100, y: 100 });
        expect(s.radius).toBe(20);
    });

    it('0・負の値・極端な値は遊べる範囲に収める', () => {
        const s = spec({ hp: 0, count: -3, interval: 0, bulletSpeed: -50, period: 0, range: -10, spread: 9999 });
        expect(s.hp).toBe(1);
        expect(s.count).toBe(1);
        expect(s.interval).toBeGreaterThan(0);
        expect(s.bulletSpeed).toBeGreaterThan(0);
        expect(s.period).toBeGreaterThan(0);
        expect(s.range).toBe(0);
        expect(s.spread).toBeCloseTo(2 * Math.PI);
    });

    it('HP と弾の数は整数にする（2.5 発は撃てない）', () => {
        expect(spec({ hp: 2.4, count: 2.6 })).toMatchObject({ hp: 2, count: 3 });
    });

    it('去る秒が 0 なら居続け、現れる前なら降りきった直後に去る', () => {
        expect(spec({ leaveAt: 0 }).leaveAt).toBeNull();
        expect(spec({ appearAt: 10, leaveAt: 5 }).leaveAt).toBe(10 + ENTRY_SECONDS);
        expect(spec({ appearAt: 10, leaveAt: 30 }).leaveAt).toBe(30);
    });

    it('大きさの無い・壊れた transform でも位置と大きさが数になる', () => {
        const s = spec({}, { x: Number.NaN, y: 10, w: 0, h: -5 });
        expect(Number.isFinite(s.home.x)).toBe(true);
        expect(s.radius).toBeGreaterThan(0);
    });

    it('知らない撃ち方・動き方は既定にする', () => {
        expect(spec({ pattern: 'laser', motion: 'teleport' })).toMatchObject({ pattern: 'radial', motion: 'sway' });
    });
});

describe('enemyPhase', () => {
    const s = spec({ appearAt: 5, leaveAt: 20 });

    it('境目の時刻はそれぞれ次の状態に入っている', () => {
        expect(enemyPhase(s, -100)).toBe('waiting');
        expect(enemyPhase(s, 4.999)).toBe('waiting');
        expect(enemyPhase(s, 5)).toBe('entering');
        expect(enemyPhase(s, activeFrom(s))).toBe('active');
        expect(enemyPhase(s, 20)).toBe('leaving');
        expect(enemyPhase(s, 20 + EXIT_SECONDS)).toBe('gone');
        expect(enemyPhase(s, 1e9)).toBe('gone');
    });

    it('去る秒が無い敵はずっと残る', () => {
        expect(enemyPhase(spec({ appearAt: 1 }), 1e9)).toBe('active');
    });

    it('画面にいるのは降りてくる・いる・去る間だけ', () => {
        expect(['waiting', 'entering', 'active', 'leaving', 'gone'].map((p) => isOnStage(p as never))).toEqual([
            false,
            true,
            true,
            true,
            false,
        ]);
    });
});

describe('enemyPosition', () => {
    it.each(['none', 'sway', 'circle'])('%s: 降りきった瞬間に定位置にいて、降りる途中から途切れない', (motion) => {
        const s = spec({ appearAt: 2, motion, range: 100, period: 3 });
        expect(enemyPosition(s, activeFrom(s)).x).toBeCloseTo(s.home.x);
        expect(enemyPosition(s, activeFrom(s)).y).toBeCloseTo(s.home.y);
        const before = enemyPosition(s, activeFrom(s) - 0.001);
        const after = enemyPosition(s, activeFrom(s) + 0.001);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
    });

    it('現れる前と降りている間は定位置より上にいる', () => {
        const s = spec({ appearAt: 2 });
        expect(enemyPosition(s, 0).y).toBeCloseTo(s.home.y - ENTRY_DISTANCE);
        expect(enemyPosition(s, 2 + ENTRY_SECONDS / 2).y).toBeLessThan(s.home.y);
    });

    it('sway は左右に range までしか動かず、上下には動かない', () => {
        const s = spec({ motion: 'sway', range: 60, period: 2 });
        const xs = Array.from({ length: 200 }, (_, i) => enemyPosition(s, activeFrom(s) + i * 0.037));
        expect(Math.max(...xs.map((p) => Math.abs(p.x - s.home.x)))).toBeLessThanOrEqual(60 + 1e-9);
        expect(new Set(xs.map((p) => p.y.toFixed(6))).size).toBe(1);
    });

    it('circle は定位置の真下 range の点を中心に回る', () => {
        const s = spec({ motion: 'circle', range: 50, period: 4 });
        for (const dt of [0, 0.3, 1, 2.2, 3.9, 17]) {
            const p = enemyPosition(s, activeFrom(s) + dt);
            expect(Math.hypot(p.x - s.home.x, p.y - (s.home.y + 50))).toBeCloseTo(50);
        }
    });

    it('去るときは上へ抜ける', () => {
        const s = spec({ appearAt: 0, leaveAt: 10, motion: 'none' });
        expect(enemyPosition(s, 10 + EXIT_SECONDS).y).toBeLessThan(enemyPosition(s, 10).y - 100);
    });

    it('同じ設定・同じ時刻ならいつ計算しても同じ（時刻が戻っても前の値に引きずられない）', () => {
        const s = spec({ motion: 'circle', range: 30 });
        const late = enemyPosition(s, 42.5);
        enemyPosition(s, 3);
        expect(enemyPosition(s, 42.5)).toEqual(late);
    });
});
