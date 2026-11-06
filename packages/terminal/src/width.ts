/**
 * 端末で文字列が占める桁数。日本語のラベルや値を揃えるために、全角を 2 桁、色の符号と結合文字を 0 桁と数える。
 */
import { stripAnsi } from './paint.ts';

/** East Asian Width が W / F の範囲（表に出る文字の大半。絵文字は扱わない）。 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
    [0x1100, 0x115f],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe30, 0xfe4f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x20000, 0x3fffd],
];

const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
    [0x0000, 0x001f],
    [0x007f, 0x009f],
    [0x0300, 0x036f],
    [0x200b, 0x200f],
    [0xfe00, 0xfe0f],
];

const within = (ranges: readonly (readonly [number, number])[], code: number): boolean =>
    ranges.some(([from, to]) => code >= from && code <= to);

const charWidth = (code: number): number => (within(ZERO_WIDTH_RANGES, code) ? 0 : within(WIDE_RANGES, code) ? 2 : 1);

export function displayWidth(text: string): number {
    return [...stripAnsi(text)].reduce((sum, char) => sum + charWidth(char.codePointAt(0) ?? 0), 0);
}

/** 右を空白で埋めて `width` 桁にする（長ければそのまま）。 */
export const padDisplay = (text: string, width: number): string =>
    text + ' '.repeat(Math.max(0, width - displayWidth(text)));
