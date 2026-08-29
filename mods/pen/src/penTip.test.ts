import { describe, expect, it } from 'vitest';
import {
    GRIP_OFFSET,
    HELD_ROTATION_DEG,
    HELD_TIP_IN_BOX,
    PEN_BOX,
    rotateAround,
    strokePointFor,
    TIP_IN_BOX,
} from './penTip';

const near = (actual: number, expected: number, tolerance = 0.01): void => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

describe('rotateAround', () => {
    it('軸そのものは動かない', () => {
        expect(rotateAround({ x: 5, y: 7 }, { x: 5, y: 7 }, 123)).toEqual({ x: 5, y: 7 });
    });

    it('0 度なら座標を変えない', () => {
        const p = rotateAround({ x: 3, y: 4 }, { x: 0, y: 0 }, 0);
        near(p.x, 3);
        near(p.y, 4);
    });

    it('原点まわりに 90 度回すと (1,0) → (0,1)（y 下向きの画面座標）', () => {
        const p = rotateAround({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
        near(p.x, 0);
        near(p.y, 1);
    });

    it('360 度回すと元に戻る', () => {
        const p = rotateAround({ x: 12, y: -3 }, { x: 4, y: 4 }, 360);
        near(p.x, 12);
        near(p.y, -3);
    });

    it('回転しても軸からの距離は変わらない', () => {
        const origin = { x: 36, y: 48 };
        const p = rotateAround(TIP_IN_BOX, origin, HELD_ROTATION_DEG);
        const before = Math.hypot(TIP_IN_BOX.x - origin.x, TIP_IN_BOX.y - origin.y);
        const after = Math.hypot(p.x - origin.x, p.y - origin.y);
        near(after, before);
    });
});

describe('ペン先の位置', () => {
    it('回転前のペン先は箱の中央に置いた SVG の穂先にある', () => {
        // SVG(18x32) を 36x48 の箱の中央に置くので x は +9, y は +8 ずれる
        expect(TIP_IN_BOX).toEqual({ x: 9 + 9, y: 8 + 32 });
    });

    it('保持中は回転するのでペン先の箱座標も変わる', () => {
        expect(HELD_TIP_IN_BOX).not.toEqual(TIP_IN_BOX);
        near(HELD_TIP_IN_BOX.x, 16.41);
        near(HELD_TIP_IN_BOX.y, 50.07);
    });

    it('ペン先は箱の下端付近にある（穂先が下を向いている）', () => {
        expect(HELD_TIP_IN_BOX.y).toBeGreaterThan(PEN_BOX.h * 0.8);
    });
});

describe('strokePointFor: 線が出る位置', () => {
    it('既定の持ち方ではペン先がカーソル位置に一致する', () => {
        const p = strokePointFor({ x: 200, y: 300 });
        near(p.x, 200);
        near(p.y, 300);
    });

    // ここが本題: 持ち方(offset)を変えても「線はペン先から出る」関係が保たれること。
    // カーソル座標をそのまま線にしていると、この関係は持ち方を変えた瞬間に壊れる。
    it('持ち方を変えるとペン先も一緒に動き、線はペン先から出続ける', () => {
        const cursor = { x: 200, y: 300 };
        const shifted = { x: GRIP_OFFSET.x + 40, y: GRIP_OFFSET.y - 25 };
        const p = strokePointFor(cursor, shifted);
        // ペンの箱ごと (+40,-25) ずれるので、ペン先も同じだけずれる
        near(p.x, 240);
        near(p.y, 275);
    });

    it('ペンの箱の左上からペン先ぶん進んだ点になる', () => {
        const cursor = { x: 0, y: 0 };
        const grip = { x: 0, y: 0 };
        // 箱の左上がカーソル位置に来る持ち方なら、線はそこからペン先ぶん進んだ位置から出る
        const p = strokePointFor(cursor, grip);
        near(p.x, HELD_TIP_IN_BOX.x);
        near(p.y, HELD_TIP_IN_BOX.y);
    });

    it('カーソルが動いた分だけ線の位置も平行移動する', () => {
        const a = strokePointFor({ x: 10, y: 20 });
        const b = strokePointFor({ x: 110, y: 220 });
        near(b.x - a.x, 100);
        near(b.y - a.y, 200);
    });
});
