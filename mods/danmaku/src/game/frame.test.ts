import { describe, expect, it } from 'vitest';
import { activeFrom, enemySpecOf } from './enemy';
import { type FrameInput, stepFrame } from './frame';
import { DOWNWARD, volleyTime } from './patterns';
import type { Shot } from './shots';

const area = { x: 0, y: 0, w: 800, h: 600 };
const enemy = (id: string, data: Record<string, unknown>) =>
    enemySpecOf({ id, transform: { x: 380, y: 80, w: 40, h: 40 }, data: { motion: 'none', ...data } });

const input = (overrides: Partial<FrameInput>): FrameInput => ({
    stageTime: 10,
    seconds: 1 / 60,
    area,
    enemies: [],
    hits: {},
    ship: null,
    shots: [],
    aim: () => DOWNWARD,
    wasAlive: new Set(),
    ...overrides,
});

const myShot = (x: number, y: number): Shot => ({ x, y, vy: -400, mine: true });

describe('stepFrame', () => {
    const ring = enemy('ring', { pattern: 'radial', count: 16, interval: 1, bulletSpeed: 100, hp: 3 });

    it('ラウンドが始まっていなければ敵も弾も出さず、当たりもない', () => {
        const frame = stepFrame(
            input({
                stageTime: null,
                enemies: [ring],
                ship: { center: { x: 400, y: 100 }, hitRadius: 4, vulnerable: true },
            }),
        );
        expect(frame.enemies).toEqual([]);
        expect(frame.bullets).toEqual([]);
        expect(frame.shipHit).toBe(false);
    });

    it('真下にいる自機は弾に当たり、無敵の自機は同じ場所でも当たらない', () => {
        const t = volleyTime(ring, 0) + 2;
        const underneath = { center: { x: 400, y: 100 + 200 }, hitRadius: 4, vulnerable: true };
        expect(stepFrame(input({ stageTime: t, enemies: [ring], ship: underneath })).shipHit).toBe(true);
        expect(
            stepFrame(input({ stageTime: t, enemies: [ring], ship: { ...underneath, vulnerable: false } })).shipHit,
        ).toBe(false);
    });

    it('敵の体に重なっても当たる', () => {
        const t = activeFrom(ring) + 0.1;
        const ship = { center: { x: 400, y: 100 }, hitRadius: 4, vulnerable: true };
        expect(stepFrame(input({ stageTime: t, enemies: [ring], ship })).shipHit).toBe(true);
    });

    it('自分の弾で HP を削り切ると、その敵と弾がその場で消え、撃破として出る', () => {
        const t = volleyTime(ring, 3);
        const before = stepFrame(input({ stageTime: t, enemies: [ring], hits: { ring: 2 } }));
        expect(before.bullets.length).toBeGreaterThan(0);
        const frame = stepFrame(
            input({
                stageTime: t,
                enemies: [ring],
                hits: { ring: 2 },
                shots: [myShot(400, 105)],
                wasAlive: before.alive,
            }),
        );
        expect(frame.myHits).toEqual({ ring: 1 });
        expect(frame.hits).toEqual({ ring: 3 });
        expect(frame.enemies).toEqual([]);
        expect(frame.bullets).toEqual([]);
        expect(frame.defeated.map((d) => d.spec.id)).toEqual(['ring']);
        expect(frame.alive.size).toBe(0);
    });

    it('ほかの人の弾は当たって消えるがダメージに数えない', () => {
        const t = activeFrom(ring) + 0.2;
        const frame = stepFrame(
            input({ stageTime: t, enemies: [ring], shots: [{ ...myShot(400, 105), mine: false }] }),
        );
        expect(frame.myHits).toEqual({});
        expect(frame.shots).toEqual([]);
        expect(frame.impacts).toHaveLength(1);
    });

    it('ほかの人が倒した敵も、前のフレームで生きていたなら撃破として出す（2 回は出さない）', () => {
        const t = activeFrom(ring) + 1;
        const first = stepFrame(
            input({ stageTime: t, enemies: [ring], hits: { ring: 3 }, wasAlive: new Set(['ring']) }),
        );
        expect(first.defeated.map((d) => d.spec.id)).toEqual(['ring']);
        const second = stepFrame(input({ stageTime: t, enemies: [ring], hits: { ring: 3 }, wasAlive: first.alive }));
        expect(second.defeated).toEqual([]);
    });

    it('まだ降りてきていない敵には弾が当たらない', () => {
        const late = enemy('late', { appearAt: 30 });
        const frame = stepFrame(input({ stageTime: 5, enemies: [late], shots: [myShot(400, 100)] }));
        expect(frame.myHits).toEqual({});
        expect(frame.shots).toHaveLength(1);
    });
});
