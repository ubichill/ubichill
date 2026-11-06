import { describe, expect, it } from 'vitest';
import { formatEvent, type LineStyle } from './event.ts';
import { ansiPaint, plainPaint, stripAnsi } from './paint.ts';
import { FALLBACK_SYMBOLS, UNICODE_SYMBOLS } from './symbols.ts';

const plain: LineStyle = { paint: plainPaint, symbols: UNICODE_SYMBOLS };
const colored: LineStyle = { paint: ansiPaint, symbols: UNICODE_SYMBOLS };
const at = new Date(2026, 10, 6, 12, 1, 3);

describe('formatEvent', () => {
    it('成功は ✓、補足は 2 つ空けて後ろに付ける', () => {
        expect(formatEvent({ level: 'success', message: 'pen を作り直しました', detail: '120 ms' }, plain)).toBe(
            '✓ pen を作り直しました  120 ms',
        );
    });

    it('時刻・範囲・記号・本文の順に並べる', () => {
        expect(formatEvent({ level: 'error', message: '失敗', scope: 'build', time: at }, plain)).toBe(
            '12:01:03 [build] ✗ 失敗',
        );
        expect(formatEvent({ level: 'warn', message: '注意', scope: 'dev', time: at }, plain)).toBe(
            '12:01:03 [dev] ! 注意',
        );
    });

    it('info・debug には記号を付けない（成功・失敗・注意と見分ける）', () => {
        expect(formatEvent({ level: 'info', message: 'hello' }, plain)).toBe('hello');
        expect(formatEvent({ level: 'debug', message: 'hello', scope: 'http' }, plain)).toBe('[http] hello');
    });

    it('複数行の本文は 2 行目以降を本文の頭に揃え、空行は字下げしない', () => {
        const text = formatEvent(
            { level: 'error', message: 'ビルドに失敗\n  src/a.ts:1:1\n\n詳しく', scope: 'build', time: at },
            plain,
        );
        expect(text.split('\n')).toEqual([
            '12:01:03 [build] ✗ ビルドに失敗',
            '                     src/a.ts:1:1',
            '',
            '                   詳しく',
        ]);
    });

    it('CRLF と末尾の改行は行を増やさない', () => {
        expect(formatEvent({ level: 'info', message: 'a\r\nb\n\n' }, plain)).toBe('a\nb');
    });

    it('空の本文でも頭だけの行になり、投げない', () => {
        expect(formatEvent({ level: 'success', message: '' }, plain)).toBe('✓');
        expect(formatEvent({ level: 'info', message: '' }, plain)).toBe('');
    });

    it('色付きでも、色を除けば色なしと同じ文字になる（揃えの桁が色の符号でずれない）', () => {
        const event = { level: 'error', message: 'x\ny', detail: '3 ms', scope: 'dev', time: at } as const;
        expect(stripAnsi(formatEvent(event, colored))).toBe(formatEvent(event, plain));
    });

    it('失敗は赤、注意は黄色で本文を塗り、debug は薄くする', () => {
        expect(formatEvent({ level: 'error', message: 'x' }, colored)).toContain('\u001b[31mx');
        expect(formatEvent({ level: 'warn', message: 'x' }, colored)).toContain('\u001b[33mx');
        expect(formatEvent({ level: 'debug', message: 'x' }, colored)).toBe('\u001b[2mx\u001b[22m');
    });

    it('範囲の色は scopeTone で変えられ、無ければ cyan', () => {
        const style: LineStyle = { ...colored, scopeTone: (s) => (s === 'instance' ? 'magenta' : undefined) };
        expect(formatEvent({ level: 'info', message: 'x', scope: 'instance' }, style)).toContain('\u001b[35m');
        expect(formatEvent({ level: 'info', message: 'x', scope: 'dev' }, style)).toContain('\u001b[36m');
    });

    it('Unicode を描けない端末では代わりの記号', () => {
        expect(formatEvent({ level: 'success', message: 'ok' }, { ...plain, symbols: FALLBACK_SYMBOLS })).toBe('√ ok');
    });
});
