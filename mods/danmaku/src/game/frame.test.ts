import { describe, expect, it } from 'vitest';
import { activeFrom, enemySpecOf } from './enemy';
import { type FrameInput, stepFrame } from './frame';
import { circlesOverlap } from './geometry';
import { BULLET_HIT_RADIUS, DOWNWARD, volleyTime } from './patterns';
import { SHOT_RADIUS, type Shot, shotFrom } from './shots';

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

    describe('60ms のフレームの間に通り抜ける速い弾', () => {
        const FRAME = 0.06;

        it('最大の速さの自分の弾が、移動の前後の間にいる敵を通り抜けても当たる', () => {
            const t = activeFrom(ring) + 0.2;
            const fastest = shotFrom({ x: 400, y: 160, speed: Number.MAX_VALUE }, true) as Shot;
            const moved = { x: 400, y: 160 + fastest.vy * FRAME };
            expect(moved.y).toBeLessThan(100 - ring.radius - SHOT_RADIUS);
            expect(circlesOverlap(moved, SHOT_RADIUS, { x: 400, y: 100 }, ring.radius)).toBe(false);
            const frame = stepFrame(input({ stageTime: t, seconds: FRAME, enemies: [ring], shots: [fastest] }));
            expect(frame.myHits).toEqual({ ring: 1 });
            expect(frame.shots).toEqual([]);
        });

        // 一番速い設定の弾（600 px/秒）は 60ms で 36px 進み、一番小さい当たり（1 + 4）の幅 10px を飛び越える
        const fast = enemy('fast', { pattern: 'radial', count: 1, interval: 100, bulletSpeed: 600 });
        const t = volleyTime(fast, 0) + 0.5;
        const bulletNow = 100 + 600 * 0.5;
        const bulletBefore = bulletNow - 600 * FRAME;
        const ship = (x: number, y: number, from?: { x: number; y: number }) => ({
            center: { x, y },
            ...(from ? { from } : {}),
            hitRadius: 1,
            vulnerable: true,
        });
        const hit = (s: ReturnType<typeof ship>, seconds = FRAME) =>
            stepFrame(input({ stageTime: t, seconds, enemies: [fast], ship: s })).shipHit;
        const reach = 1 + BULLET_HIT_RADIUS;
        const between = (bulletBefore + bulletNow) / 2;

        it('敵の弾が、前のフレームと今の間にいる自機を飛び越えても当たる', () => {
            expect(between - bulletBefore).toBeGreaterThan(reach);
            expect(bulletNow - between).toBeGreaterThan(reach);
            expect(hit(ship(400, between))).toBe(true);
        });

        it('通り道から当たりの半径のわずかに外なら当たらない', () => {
            expect(hit(ship(400 + reach + 0.01, between))).toBe(false);
            expect(hit(ship(400 + reach - 0.01, between))).toBe(true);
        });

        it('時間が進んでいない（0 秒の）フレームは今の位置だけで見る', () => {
            expect(hit(ship(400, between), 0)).toBe(false);
            expect(hit(ship(400, bulletNow - reach + 0.01), 0)).toBe(true);
        });

        it('自機が動いて弾とすれ違っても当たる（自機の前の位置からの動きも見る）', () => {
            // 自機は最高速 600 px/秒で 36px 上がる。止まっていたとすると通り道から 8 離れている
            const passing = ship(400, bulletBefore - 8, { x: 400, y: bulletBefore - 8 + 36 });
            expect(hit({ ...passing, from: undefined })).toBe(false);
            expect(hit(passing)).toBe(true);
        });
    });
});
