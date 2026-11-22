import { describe, expect, it } from 'vitest';
import { prefersLossless, triesLossless } from './webpEncoding';

const KB = 1024;

describe('triesLossless', () => {
    // 実測（非可逆の大きさ）: 平らな絵 1600×1200 で 13.9 KB・アプリのスクリーンショット 1280×720 で 28.8 KB・
    // 写真の PNG 1920×1080 で 196 KB・細かいドット絵 32×32 で 608 B（0.59 B/px。可逆なら 60 B）
    it.each([
        ['png', 13.9 * KB, 1600, 1200, true],
        ['png', 608, 32, 32, true],
        ['gif', 2.5 * KB, 256, 256, true],
        ['png', 28.8 * KB, 1280, 720, false],
        ['png', 196 * KB, 1920, 1080, false],
        // 写真の形式は、小さくても平らでも可逆を試さない
        ['jpeg', 608, 32, 32, false],
        ['webp', 608, 32, 32, false],
        ['heif', 608, 32, 32, false],
        [undefined, 608, 32, 32, false],
    ] as const)('%s・非可逆 %d バイト・%d×%d なら可逆も作るか: %s', (format, bytes, width, height, expected) => {
        expect(triesLossless(format, { bytes, width, height })).toBe(expected);
    });

    it('512×512 までは必ず作る。それより大きければ 1 画素あたり 0.02 バイトが境目', () => {
        expect(triesLossless('png', { bytes: 512 * 512, width: 512, height: 512 })).toBe(true);
        expect(triesLossless('png', { bytes: 513 * 512 * 0.02, width: 513, height: 512 })).toBe(true);
        expect(triesLossless('png', { bytes: 513 * 512 * 0.02 + 1, width: 513, height: 512 })).toBe(false);
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
