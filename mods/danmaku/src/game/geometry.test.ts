import { describe, expect, it } from 'vitest';
import { areaFor, areaOf, DEFAULT_AREA, shipIsHit } from './area';
import { readColor, readEnum, readNumber } from './fields';
import { circlesOverlap, clamp, clampRectInto } from './geometry';

const area = { x: 100, y: 50, w: 400, h: 300 };

describe('clampRectInto', () => {
    it('中にある箱は動かさず、外へはみ出した箱は辺まで押し戻す', () => {
        const box = { x: 200, y: 100, w: 32, h: 32 };
        expect(clampRectInto(box, area)).toEqual(box);
        expect(clampRectInto({ ...box, x: -1000 }, area).x).toBe(100);
        expect(clampRectInto({ ...box, x: 1000 }, area).x).toBe(100 + 400 - 32);
        expect(clampRectInto({ ...box, y: -5 }, area).y).toBe(50);
        expect(clampRectInto({ ...box, y: 9999 }, area).y).toBe(50 + 300 - 32);
    });

    it('範囲より大きい箱は、はみ出す分を両側に振り分けて真ん中に置く', () => {
        expect(clampRectInto({ x: 0, y: 0, w: 500, h: 10 }, area)).toEqual({ x: 50, y: 0 + 50, w: 500, h: 10 });
    });

    it('transform のほかの項目（z・scale など）は残す', () => {
        const transform = { x: -50, y: 60, z: 10, w: 32, h: 32, scale: 1, rotation: 0 };
        expect(clampRectInto(transform, area)).toEqual({ ...transform, x: 100 });
    });
});

describe('clamp・circlesOverlap', () => {
    it('min > max なら min を返す', () => {
        expect(clamp(5, 10, 0)).toBe(10);
    });

    it('ちょうど触れているだけなら重なっていない', () => {
        expect(circlesOverlap({ x: 0, y: 0 }, 3, { x: 7, y: 0 }, 4)).toBe(false);
        expect(circlesOverlap({ x: 0, y: 0 }, 3, { x: 6.99, y: 0 }, 4)).toBe(true);
    });
});

describe('fields（信用しない data を読む）', () => {
    const range = { fallback: 5, min: 1, max: 10 };

    it.each([
        ['文字列', '7'],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['null', null],
        ['オブジェクト', { valueOf: (): number => 7 }],
    ])('%s は既定値にする', (_, value) => {
        expect(readNumber({ v: value }, 'v', range)).toBe(5);
    });

    it('範囲の外は範囲の端にする', () => {
        expect(readNumber({ v: -100 }, 'v', range)).toBe(1);
        expect(readNumber({ v: 1e9 }, 'v', range)).toBe(10);
    });

    it('enum は候補にない値・大文字違いを既定値にする', () => {
        expect(readEnum({ m: 'SWAY' }, 'm', ['none', 'sway'], 'none')).toBe('none');
        expect(readEnum({ m: 'sway' }, 'm', ['none', 'sway'], 'none')).toBe('sway');
    });

    it('色は #rgb・#rrggbb だけを通す（canvas に任意の文字列を渡さない）', () => {
        expect(readColor({ c: '#abc' }, 'c', '#000')).toBe('#abc');
        expect(readColor({ c: '#A1B2C3' }, 'c', '#000')).toBe('#A1B2C3');
        for (const bad of ['red', '#12345', 'url(x)', '#abcd', ' #abc', 3]) {
            expect(readColor({ c: bad }, 'c', '#000')).toBe('#000');
        }
    });
});

describe('遊ぶ範囲', () => {
    it('大きさの無い範囲は既定の大きさで、位置は Entity のものを使う', () => {
        expect(areaOf({ x: 10, y: 20 })).toEqual({ ...DEFAULT_AREA, x: 10, y: 20 });
        expect(areaOf({ x: 10, y: 20, w: 0, h: 300 })).toEqual({ ...DEFAULT_AREA, x: 10, y: 20 });
        expect(areaOf({ x: Number.NaN, y: 20, w: 300, h: 200 })).toEqual({ x: 0, y: 20, w: 300, h: 200 });
        expect(areaOf(undefined)).toEqual(DEFAULT_AREA);
    });

    it('自機の中心を含む範囲を選び、どれにも入っていなければ一番近い範囲にする', () => {
        const left = { id: 'l', area: { x: 0, y: 0, w: 100, h: 100 } };
        const right = { id: 'r', area: { x: 500, y: 0, w: 100, h: 100 } };
        expect(areaFor({ x: 550, y: 50 }, [left, right])?.id).toBe('r');
        expect(areaFor({ x: 380, y: 50 }, [left, right])?.id).toBe('r');
        expect(areaFor({ x: 120, y: 50 }, [left, right])?.id).toBe('l');
        expect(areaFor({ x: 0, y: 0 }, [])).toBeNull();
    });
});

describe('shipIsHit', () => {
    const bullet = (x: number, y: number) => ({ x, y, enemyId: 'e', color: '#fff' });

    it('弾の当たりは見た目より小さく、自機の判定の半径と足した距離より近いときだけ当たる', () => {
        expect(shipIsHit({ x: 0, y: 0 }, 4, [bullet(7.9, 0)], [])).toBe(true);
        expect(shipIsHit({ x: 0, y: 0 }, 4, [bullet(8, 0)], [])).toBe(false);
    });

    it('敵の体に重なっても当たる（体当たり）', () => {
        expect(shipIsHit({ x: 0, y: 0 }, 4, [], [{ center: { x: 15, y: 0 }, radius: 20 }])).toBe(true);
        expect(shipIsHit({ x: 0, y: 0 }, 4, [], [{ center: { x: 30, y: 0 }, radius: 20 }])).toBe(false);
    });
});
