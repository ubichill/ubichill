import { describe, expect, it } from 'vitest';
import { describeError, formatError, HintedError, messageOf } from './error.ts';
import type { LineStyle } from './event.ts';
import { ansiPaint, plainPaint, stripAnsi } from './paint.ts';
import { UNICODE_SYMBOLS } from './symbols.ts';

const plain: LineStyle = { paint: plainPaint, symbols: UNICODE_SYMBOLS };

describe('messageOf', () => {
    it('Error でないものを投げられても読める文にする', () => {
        expect(messageOf('文字列')).toBe('文字列');
        expect(messageOf(undefined)).toBe('undefined');
        expect(messageOf(null)).toBe('null');
        expect(messageOf(42)).toBe('42');
        expect(messageOf({ message: 'オブジェクトの message' })).toBe('オブジェクトの message');
        expect(messageOf({ code: 'E1' })).toBe("{ code: 'E1' }");
    });

    it('メッセージが空の Error は名前を出す（空行にしない）', () => {
        expect(messageOf(new TypeError(''))).toBe('TypeError');
    });
});

describe('describeError', () => {
    it('cause を順に辿り、自分を指す循環でも止まる', () => {
        const inner = new Error('inner');
        const outer = new Error('outer', { cause: inner });
        (inner as { cause?: unknown }).cause = outer;
        expect(describeError(outer).causes).toEqual(['inner']);
    });

    it('cause の連鎖は 5 段までで打ち切る', () => {
        const deepest = Array.from({ length: 20 }).reduce<Error>(
            (cause, _, i) => new Error(`e${i}`, { cause }),
            new Error('root'),
        );
        expect(describeError(deepest).causes).toHaveLength(5);
    });

    it('hint を持つエラーは hint を取り出す（空の hint は無いものとする）', () => {
        expect(describeError(new HintedError('x', 'こうする')).hint).toBe('こうする');
        expect(describeError(Object.assign(new Error('x'), { hint: '' })).hint).toBeUndefined();
        expect(describeError(Object.assign(new Error('x'), { hint: 3 })).hint).toBeUndefined();
    });

    it('AggregateError の中身を並べる', () => {
        expect(describeError(new AggregateError([new Error('a'), 'b'], 'まとめて失敗')).errors).toEqual(['a', 'b']);
    });

    it('スタックはメッセージの行を除いた at の行だけ（メッセージに at を含んでも混ぜない）', () => {
        const error = new Error('at the end');
        error.stack = 'Error: at the end\n    at f (a.js:1:1)\n    at g (b.js:2:2)';
        expect(describeError(error).frames).toEqual(['at f (a.js:1:1)', 'at g (b.js:2:2)']);
    });
});

describe('formatError', () => {
    const error = new HintedError('listen EADDRINUSE 127.0.0.1:3333\n詳しい説明', '--port=<n> で別のポートを指定', {
        cause: new Error('内側'),
    });

    it('ふだんはメッセージ・原因・hint だけでスタックを出さない', () => {
        expect(formatError(error, { debug: false }, plain).split('\n')).toEqual([
            '✗ listen EADDRINUSE 127.0.0.1:3333',
            '  詳しい説明',
            '  原因: 内側',
            '  ➜ --port=<n> で別のポートを指定',
        ]);
    });

    it('--debug ではスタックも出す', () => {
        const text = formatError(error, { debug: true }, plain);
        expect(text).toContain('    at ');
    });

    it('debug でないときだけ debugTip を添える', () => {
        expect(formatError(new TypeError('x'), { debug: false, debugTip: '--debug で詳しく' }, plain)).toBe(
            '✗ x\n  --debug で詳しく',
        );
        expect(formatError(new TypeError('x'), { debug: true, debugTip: '--debug で詳しく' }, plain)).not.toContain(
            '--debug で詳しく',
        );
    });

    it('呼び出し側の hint はエラーの hint より優先する', () => {
        expect(formatError(error, { debug: false, hint: '別の案内' }, plain)).toContain('➜ 別の案内');
    });

    it('色を除けば色なしと同じ', () => {
        expect(stripAnsi(formatError(error, { debug: false }, { ...plain, paint: ansiPaint }))).toBe(
            formatError(error, { debug: false }, plain),
        );
    });
});
