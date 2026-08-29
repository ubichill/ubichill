import { describe, expect, it } from 'vitest';
import { dropPointInTray } from './trayDrop';

/** default.yaml の 1 つ目のトレイ相当 (画面座標 16,16 / 266x67)。 */
const TRAY = { x: 16, y: 16, w: 266, h: 67 };
const PEN = { w: 36, h: 48 };

describe('dropPointInTray: トレイの押した場所にペンを置く', () => {
    it('押した点がペンの中心に来る', () => {
        const p = dropPointInTray(TRAY, { x: 133, y: 33 }, PEN);
        // transform は左上基準なので、中心に来るよう半分ぶん引く
        expect(p).toEqual({ x: 16 + 133 - 18, y: 16 + 33 - 24 });
    });

    it('押す場所を変えれば置かれる場所も変わる（トレイ原点に吸着しない）', () => {
        const left = dropPointInTray(TRAY, { x: 40, y: 33 }, PEN);
        const right = dropPointInTray(TRAY, { x: 200, y: 33 }, PEN);
        expect(right.x - left.x).toBe(160);
        expect(left).not.toEqual({ x: TRAY.x, y: TRAY.y });
    });

    it('左上の端を押してもトレイからはみ出さない', () => {
        expect(dropPointInTray(TRAY, { x: 0, y: 0 }, PEN)).toEqual({ x: 16, y: 16 });
    });

    it('右下の端を押してもトレイの内側に収まる', () => {
        const p = dropPointInTray(TRAY, { x: TRAY.w, y: TRAY.h }, PEN);
        expect(p).toEqual({ x: 16 + 266 - 36, y: 16 + 67 - 48 });
        // ペン全体がトレイの矩形に収まっている
        expect(p.x + PEN.w).toBeLessThanOrEqual(TRAY.x + TRAY.w);
        expect(p.y + PEN.h).toBeLessThanOrEqual(TRAY.y + TRAY.h);
    });

    it('トレイ外の座標が来ても内側に丸める', () => {
        const p = dropPointInTray(TRAY, { x: -500, y: 9999 }, PEN);
        expect(p.x).toBe(TRAY.x);
        expect(p.y).toBe(TRAY.y + TRAY.h - PEN.h);
    });

    it('ペンがトレイより大きい場合はトレイ原点に寄せる（負の位置へ飛ばさない）', () => {
        const p = dropPointInTray({ x: 10, y: 10, w: 20, h: 20 }, { x: 10, y: 10 }, PEN);
        expect(p).toEqual({ x: 10, y: 10 });
    });
});
