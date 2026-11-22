import { describe, expect, it } from 'vitest';
import {
    canBeHit,
    FOCUS_SPEED_SCALE,
    freshShip,
    isDown,
    isInvincible,
    MAX_STEP_SECONDS,
    moveInput,
    moveShip,
    respawnBox,
    respawnCountdown,
    respawned,
    shipControlsOf,
    shipMarksOf,
    shipRulesOf,
    shipStatusOf,
    shipVisible,
    shouldRespawn,
    takeHit,
} from './ship';

const rules = shipRulesOf({ maxHp: 3, invincibleSeconds: 2, respawnSeconds: 3 });
const area = { x: 0, y: 0, w: 800, h: 600 };
const box = { x: 384, y: 400, w: 32, h: 32 };
const still = { dx: 0, dy: 0, focus: false };

describe('shipRulesOf・shipStatusOf', () => {
    it('Inspector の値が 0・負・壊れていても遊べる値にする', () => {
        expect(shipRulesOf({ maxHp: 0, invincibleSeconds: -1, respawnSeconds: 0 })).toEqual({
            maxHp: 1,
            invincibleMs: 0,
            respawnMs: 500,
        });
        expect(shipRulesOf({ maxHp: 'x' }).maxHp).toBe(5);
        expect(shipRulesOf(null).maxHp).toBe(5);
    });

    it('同期された HP は 0〜最大の整数に収め、壊れていれば満タンとみなす', () => {
        expect(shipStatusOf(99, 0, 0, rules).hp).toBe(3);
        expect(shipStatusOf(-4, 0, 0, rules).hp).toBe(0);
        expect(shipStatusOf(1.6, 0, 0, rules).hp).toBe(2);
        expect(shipStatusOf('1', 0, 0, rules).hp).toBe(3);
        expect(shipStatusOf(2, -50, Number.NaN, rules)).toEqual({ hp: 2, hitAt: 0, downAt: 0 });
    });
});

describe('被弾', () => {
    it('当たると 1 減り、無敵の間は減らず、無敵が切れるとまた減る', () => {
        const once = takeHit(freshShip(rules), rules, 10_000);
        expect(once.hp).toBe(2);
        expect(takeHit(once, rules, 10_500)).toBe(once);
        expect(takeHit(once, rules, 11_999)).toBe(once);
        expect(takeHit(once, rules, 12_000).hp).toBe(1);
    });

    it('HP が 0 になったら撃墜され、撃墜中はもう当たらない', () => {
        const last = { hp: 1, hitAt: 0, downAt: 0 };
        const down = takeHit(last, rules, 50_000);
        expect(down).toEqual({ hp: 0, hitAt: 50_000, downAt: 50_000 });
        expect(isDown(down)).toBe(true);
        expect(canBeHit(down, rules, 99_999)).toBe(false);
        expect(takeHit(down, rules, 99_999)).toBe(down);
    });

    it('無敵 0 秒なら同じ瞬間の当たりも続けて数える', () => {
        const noGrace = shipRulesOf({ maxHp: 3, invincibleSeconds: 0 });
        const twice = takeHit(takeHit(freshShip(noGrace), noGrace, 7_000), noGrace, 7_000);
        expect(twice.hp).toBe(1);
    });

    it('時刻 0 に当たっても「当たっていない(0)」と区別できる', () => {
        const hit = takeHit(freshShip(rules), rules, 0);
        expect(hit.hitAt).toBeGreaterThan(0);
        expect(isInvincible(hit, rules, 0)).toBe(true);
    });

    it('時計が大きく戻って被弾が未来になっても、ずっと無敵にはならない', () => {
        const hit = takeHit(freshShip(rules), rules, 1_000_000);
        expect(isInvincible(hit, rules, 999_000)).toBe(true);
        expect(isInvincible(hit, rules, 100_000)).toBe(false);
    });
});

describe('撃墜と復活', () => {
    const down = { hp: 0, hitAt: 20_000, downAt: 20_000 };

    it('決めた秒が過ぎたら復活し、満タンで少しのあいだ無敵', () => {
        expect(shouldRespawn(down, rules, 22_999)).toBe(false);
        expect(shouldRespawn(down, rules, 23_000)).toBe(true);
        const back = respawned(rules, 23_000);
        expect(back).toEqual({ hp: 3, hitAt: 23_000, downAt: 0 });
        expect(canBeHit(back, rules, 23_500)).toBe(false);
        expect(canBeHit(back, rules, 25_000)).toBe(true);
    });

    it('時計が戻っても撃墜のまま止まらない', () => {
        expect(shouldRespawn(down, rules, 10_000)).toBe(true);
    });

    it('復活までの残り秒を切り上げで出す', () => {
        expect(respawnCountdown(down, rules, 20_000)).toBe(3);
        expect(respawnCountdown(down, rules, 22_001)).toBe(1);
        expect(respawnCountdown(down, rules, 40_000)).toBe(0);
        expect(respawnCountdown(freshShip(rules), rules, 40_000)).toBe(0);
    });

    it('無敵の間は点滅し、撃墜中は見せない', () => {
        const hit = takeHit(freshShip(rules), rules, 10_000);
        const frames = Array.from({ length: 20 }, (_, i) => shipVisible(hit, rules, 10_000 + i * 40));
        expect(frames).toContain(true);
        expect(frames).toContain(false);
        expect(shipVisible(hit, rules, 13_000)).toBe(true);
        expect(shipVisible(down, rules, 20_100)).toBe(false);
    });
});

describe('移動', () => {
    it('斜めでも速さは変わらない', () => {
        const moved = moveShip(box, { dx: 1, dy: 1, focus: false }, 100, 0.05, area);
        expect(Math.hypot(moved.x - box.x, moved.y - box.y)).toBeCloseTo(5);
    });

    it('範囲の端で止まる（壁の代わり）', () => {
        const pushed = moveShip({ ...box, x: 790 }, { dx: 1, dy: 0, focus: false }, 600, 0.1, area);
        expect(pushed.x).toBe(800 - 32);
        const up = moveShip({ ...box, y: 2 }, { dx: 0, dy: -1, focus: false }, 600, 0.1, area);
        expect(up.y).toBe(0);
    });

    it('止まっている入力・負の速さ・NaN の時間では動かない（範囲の外にいたら中へ戻すだけ）', () => {
        expect(moveShip(box, still, 200, 0.016, area)).toEqual(box);
        expect(moveShip(box, { dx: 1, dy: 0, focus: false }, -200, 0.016, area)).toEqual(box);
        expect(moveShip(box, { dx: 1, dy: 0, focus: false }, 200, Number.NaN, area)).toEqual(box);
        expect(moveShip({ ...box, x: -500 }, still, 200, 0.016, area).x).toBe(0);
    });

    it('タブが裏から戻った直後の大きな経過時間でも、1 フレーム分しか進まない', () => {
        const moved = moveShip(box, { dx: -1, dy: 0, focus: false }, 100, 30, area);
        expect(box.x - moved.x).toBeCloseTo(100 * MAX_STEP_SECONDS);
    });

    it('Shift の間は遅くなり、反対のキーを同時に押すと打ち消す', () => {
        const slow = moveShip(box, { dx: 1, dy: 0, focus: true }, 100, 0.1, area);
        expect(slow.x - box.x).toBeCloseTo(10 * FOCUS_SPEED_SCALE);
        const keys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ShiftRight']);
        expect(moveInput((code) => keys.has(code))).toEqual({ dx: 0, dy: -1, focus: true });
    });

    it('復活する位置は範囲の下の真ん中で、範囲の中', () => {
        const small = { x: 100, y: 100, w: 200, h: 60 };
        const spot = respawnBox(box, small);
        expect(spot.x).toBe(100 + 100 - 16);
        expect(spot.y).toBeGreaterThanOrEqual(100);
        expect(spot.y + spot.h).toBeLessThanOrEqual(160);
    });
});

describe('shipMarksOf', () => {
    it('壊れた・負の時刻は 0（被弾していない）にする', () => {
        expect(shipMarksOf({ hitAt: 'x', downAt: -1 })).toEqual({ hitAt: 0, downAt: 0 });
        expect(shipMarksOf(null)).toEqual({ hitAt: 0, downAt: 0 });
        expect(shipMarksOf({ hitAt: 5, downAt: 7 })).toEqual({ hitAt: 5, downAt: 7 });
    });
});

describe('shipControlsOf', () => {
    it('ほかの人が乗っていない自機の data に書いた極端な値・壊れた値を Inspector の範囲に収める', () => {
        expect(
            shipControlsOf({ speed: 1e9, fireRate: 0, bulletSpeed: -5, autoFire: 'yes', hitRadius: Number.NaN }),
        ).toEqual({
            speed: 600,
            fireRate: 1,
            bulletSpeed: 50,
            autoFire: true,
            hitRadius: 4,
        });
        expect(shipControlsOf({ autoFire: false }).autoFire).toBe(false);
    });
});
