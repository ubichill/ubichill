import { describe, expect, it } from 'vitest';
import { hasFewColors, prefersLossless, triesLossless } from './webpEncoding';

/** n 色を順に並べた RGBA */
const rgbaOf = (colors: number, pixels = colors) =>
    new Uint8Array(Array.from({ length: pixels }, (_, n) => [n % colors, (n % colors) >> 8, 7, 255]).flat());

describe('hasFewColors', () => {
    it('256 色までは true、257 色で false', () => {
        expect(hasFewColors(rgbaOf(256, 10_000))).toBe(true);
        expect(hasFewColors(rgbaOf(257, 10_000))).toBe(false);
    });

    it('同じ RGB でも透明度が違えば別の色', () => {
        const rgba = new Uint8Array([1, 2, 3, 255, 1, 2, 3, 0]);
        expect(hasFewColors(rgba, 1)).toBe(false);
        expect(hasFewColors(rgba, 2)).toBe(true);
    });

    it('4 の倍数でない位置から始まる配列も読める', () => {
        const backing = new Uint8Array(1 + 4 * 3);
        backing.set([9, 9, 9, 255, 9, 9, 9, 255, 8, 8, 8, 255], 1);
        expect(hasFewColors(backing.subarray(1), 1)).toBe(false);
        expect(hasFewColors(backing.subarray(1), 2)).toBe(true);
    });
});

describe('triesLossless', () => {
    it('PNG・GIF で色が少ないときだけ', () => {
        expect(triesLossless('png', rgbaOf(16))).toBe(true);
        expect(triesLossless('gif', rgbaOf(256))).toBe(true);
        expect(triesLossless('png', rgbaOf(257))).toBe(false);
        for (const format of ['jpeg', 'webp', 'heif', undefined]) expect(triesLossless(format, rgbaOf(2))).toBe(false);
    });
});

describe('prefersLossless', () => {
    it.each([
        // 実測: ドット絵（2.6 KB / 0.3 KB）・平らな絵（13.9 KB / 14.2 KB）
        [2600, 300, true],
        [13_900, 14_200, true],
        // 1.1 倍ちょうどは可逆、越えたら非可逆
        [1000, 1100, true],
        [1000, 1101, false],
    ])('非可逆 %d バイト・可逆 %d バイトなら可逆を選ぶか: %s', (lossy, lossless, expected) => {
        expect(prefersLossless(lossy, lossless)).toBe(expected);
    });
});
