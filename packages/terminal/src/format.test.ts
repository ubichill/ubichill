import { describe, expect, it } from 'vitest';
import { formatBytes, formatClock, formatDuration } from './format.ts';

describe('formatDuration', () => {
    it.each([
        [0, '0 ms'],
        [0.4, '0 ms'],
        [812, '812 ms'],
        [999.4, '999 ms'],
        // 丸めると 1000 になる値は秒で表す（「1000 ms」にしない）
        [999.5, '1.0 s'],
        [1234, '1.2 s'],
        [59_949, '59.9 s'],
        // 丸めると 60.0 s になる値は分で表す
        [59_950, '1 min 0 s'],
        [125_000, '2 min 5 s'],
        [3_599_499, '59 min 59 s'],
        [3_599_500, '1 h 0 min'],
        [3_780_000, '1 h 3 min'],
    ])('%d ms → %s', (ms, text) => {
        expect(formatDuration(ms)).toBe(text);
    });

    it('負の値（時計の巻き戻り）は 0 ms、数でない値は -', () => {
        expect(formatDuration(-5)).toBe('0 ms');
        expect(formatDuration(-0)).toBe('0 ms');
        expect(formatDuration(Number.NaN)).toBe('-');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('-');
    });
});

describe('formatClock', () => {
    it('手元の時刻を 2 桁ずつ HH:MM:SS にする', () => {
        expect(formatClock(new Date(2026, 10, 6, 9, 5, 3))).toBe('09:05:03');
        expect(formatClock(new Date(2026, 10, 6, 23, 59, 59, 999))).toBe('23:59:59');
    });

    it('不正な日時でも投げない', () => {
        expect(formatClock(new Date(Number.NaN))).toBe('--:--:--');
    });
});

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [999, '999 B'],
        [999.6, '1.0 kB'],
        [1000, '1.0 kB'],
        [48_321, '48.3 kB'],
        // 丸めると 1000.0 kB になる値は MB で表す
        [999_950, '1.0 MB'],
        [1_234_567, '1.2 MB'],
    ])('%d → %s', (bytes, text) => {
        expect(formatBytes(bytes)).toBe(text);
    });

    it('負の値・数でない値は -', () => {
        expect(formatBytes(-1)).toBe('-');
        expect(formatBytes(Number.NaN)).toBe('-');
    });
});
