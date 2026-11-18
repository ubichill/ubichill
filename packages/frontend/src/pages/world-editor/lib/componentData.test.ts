import { describe, expect, it } from 'vitest';
import { isPlainObject, parseComponentDataJson } from './componentData';

describe('isPlainObject', () => {
    it('{ } だけを通す', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ a: 1 })).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
    });

    it('null・配列・数値・文字列・真偽値・undefined は通さない', () => {
        for (const v of [null, [], [1], 0, 5, '', 'x', true, false, undefined]) {
            expect(isPlainObject(v)).toBe(false);
        }
    });
});

describe('parseComponentDataJson: JSON タブの入力を Component の data にする', () => {
    it('オブジェクトはそのまま data にする', () => {
        expect(parseComponentDataJson('{"screen":"tv","n":1}')).toEqual({ ok: true, data: { screen: 'tv', n: 1 } });
    });

    it('空・空白だけは空の data にする', () => {
        expect(parseComponentDataJson('')).toEqual({ ok: true, data: {} });
        expect(parseComponentDataJson('  \n ')).toEqual({ ok: true, data: {} });
    });

    it('null・配列・数値・文字列は data にしない（参照の付け替えや保存で落ちないように）', () => {
        for (const text of ['null', '[]', '[{"a":1}]', '5', '"x"', 'true']) {
            expect(parseComponentDataJson(text).ok).toBe(false);
        }
    });

    it('JSON として読めない入力は、理由を返して data にしない', () => {
        const result = parseComponentDataJson('{"a":');
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.error).not.toBe('');
    });

    it('入れ子や大きな入力も読める', () => {
        const big = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, { v: [i, null] }]));
        const result = parseComponentDataJson(JSON.stringify(big));
        expect(result.ok && Object.keys(result.data)).toHaveLength(2000);
    });
});
