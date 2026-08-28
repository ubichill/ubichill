import { describe, expect, it } from 'vitest';
import { AXIS_THRESHOLD, diffDirections, directionsFor, resolveStick } from './stick';

/** 132px 角のスティック（実装の既定サイズ）。中心は (66, 66)、半径 66。 */
const BOX = { width: 132, height: 132 };
const CENTER = { x: 66, y: 66 };
const codesAt = (x: number, y: number): string[] => [...resolveStick({ ...BOX, x, y }).codes].sort();

describe('directionsFor: 8方向のキー変換', () => {
    it('中心付近はデッドゾーンでニュートラル', () => {
        expect([...directionsFor(0, 0)]).toEqual([]);
        expect([...directionsFor(0.2, 0.1)]).toEqual([]);
    });

    it('真横・真上下は1キーだけ立てる', () => {
        expect([...directionsFor(1, 0)]).toEqual(['ArrowRight']);
        expect([...directionsFor(-1, 0)]).toEqual(['ArrowLeft']);
        // y は下が正（画面座標）なので +1 が ArrowDown
        expect([...directionsFor(0, 1)]).toEqual(['ArrowDown']);
        expect([...directionsFor(0, -1)]).toEqual(['ArrowUp']);
    });

    it('斜めは2キー同時に立てる（8方向）', () => {
        const d = Math.SQRT1_2; // 45度
        expect([...directionsFor(d, d)].sort()).toEqual(['ArrowDown', 'ArrowRight']);
        expect([...directionsFor(-d, -d)].sort()).toEqual(['ArrowLeft', 'ArrowUp']);
        expect([...directionsFor(d, -d)].sort()).toEqual(['ArrowRight', 'ArrowUp']);
        expect([...directionsFor(-d, d)].sort()).toEqual(['ArrowDown', 'ArrowLeft']);
    });

    it('相反する方向が同時に立つことはない', () => {
        for (const [nx, ny] of [
            [1, 0],
            [-1, 0],
            [0.5, 0.9],
            [-0.9, 0.5],
            [0.7, -0.7],
        ]) {
            const codes = directionsFor(nx, ny);
            expect(codes.has('ArrowLeft') && codes.has('ArrowRight')).toBe(false);
            expect(codes.has('ArrowUp') && codes.has('ArrowDown')).toBe(false);
        }
    });

    it('軸の閾値ちょうど手前ではその軸のキーを立てない', () => {
        // 真横方向へ倒しきった状態から、軸成分だけを閾値未満にする
        expect(directionsFor(AXIS_THRESHOLD - 0.01, 0.95).has('ArrowRight')).toBe(false);
        expect(directionsFor(AXIS_THRESHOLD + 0.01, 0.95).has('ArrowRight')).toBe(true);
    });
});

describe('resolveStick: ローカル座標からノブ位置と方向を求める', () => {
    it('中心を押した場合はノブも中心でニュートラル', () => {
        const s = resolveStick({ ...BOX, ...CENTER });
        expect(s).toMatchObject({ knobX: 0, knobY: 0 });
        expect([...s.codes]).toEqual([]);
    });

    it('右端を押すとノブが右へ寄り ArrowRight になる', () => {
        const s = resolveStick({ ...BOX, x: 132, y: 66 });
        expect(s.knobX).toBe(66);
        expect(s.knobY).toBe(0);
        expect([...s.codes]).toEqual(['ArrowRight']);
    });

    it('要素の外へ出てもノブは半径で止まり、方向は維持される', () => {
        const s = resolveStick({ ...BOX, x: 500, y: 66 });
        // 半径 66 を超えない
        expect(Math.hypot(s.knobX, s.knobY)).toBeLessThanOrEqual(66);
        expect(s.knobX).toBe(66);
        expect([...s.codes]).toEqual(['ArrowRight']);
    });

    it('斜め方向に大きく外れてもノブは円内に収まる', () => {
        const s = resolveStick({ ...BOX, x: 400, y: 400 });
        expect(Math.hypot(s.knobX, s.knobY)).toBeLessThanOrEqual(67); // 丸め誤差 1px 許容
        expect([...s.codes].sort()).toEqual(['ArrowDown', 'ArrowRight']);
    });

    it('レイアウト前（サイズ 0）はニュートラルを返して誤爆しない', () => {
        const s = resolveStick({ width: 0, height: 0, x: 0, y: 0 });
        expect(s).toMatchObject({ knobX: 0, knobY: 0 });
        expect([...s.codes]).toEqual([]);
    });

    it('上下の向きが画面座標（下が正）と一致する', () => {
        expect(codesAt(66, 0)).toEqual(['ArrowUp']);
        expect(codesAt(66, 132)).toEqual(['ArrowDown']);
    });

    it('四隅は斜め2方向になる', () => {
        expect(codesAt(0, 0)).toEqual(['ArrowLeft', 'ArrowUp']);
        expect(codesAt(132, 132)).toEqual(['ArrowDown', 'ArrowRight']);
    });
});

describe('diffDirections: 差分だけを送る', () => {
    it('増えた分を pressed、消えた分を released で返す', () => {
        const d = diffDirections(new Set(['ArrowLeft']), new Set(['ArrowLeft', 'ArrowUp']));
        expect(d.pressed).toEqual(['ArrowUp']);
        expect(d.released).toEqual([]);
    });

    it('方向を切り替えたときは離しと押しが両方出る', () => {
        const d = diffDirections(new Set(['ArrowLeft']), new Set(['ArrowRight']));
        expect(d.pressed).toEqual(['ArrowRight']);
        expect(d.released).toEqual(['ArrowLeft']);
    });

    it('変化なしなら何も出ない（毎フレーム送信で溢れさせない）', () => {
        const same = new Set(['ArrowUp', 'ArrowRight']);
        const d = diffDirections(same, new Set(['ArrowUp', 'ArrowRight']));
        expect(d.pressed).toEqual([]);
        expect(d.released).toEqual([]);
    });

    it('ニュートラルへ戻すと全部 released になる（押しっぱなし防止）', () => {
        const d = diffDirections(new Set(['ArrowUp', 'ArrowRight']), new Set());
        expect(d.pressed).toEqual([]);
        expect(d.released.sort()).toEqual(['ArrowRight', 'ArrowUp']);
    });
});
