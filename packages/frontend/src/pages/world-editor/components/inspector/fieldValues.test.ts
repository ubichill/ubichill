import { describe, expect, it } from 'vitest';
import { displayedFieldValue } from './fieldValues';

describe('displayedFieldValue', () => {
    it('data にある値をそのまま出す（空文字・null も含む）', () => {
        expect(displayedFieldValue({ type: 'string', default: 'x' }, { title: '' }, 'title')).toBe('');
        expect(displayedFieldValue({ type: 'entityRef', default: 'tv' }, { screen: null }, 'screen')).toBeNull();
    });

    it('data に無い参照は既定値を出さず空にする（配送は data しか読まない）', () => {
        expect(displayedFieldValue({ type: 'entityRef', default: 'tv' }, {}, 'screen')).toBeNull();
        expect(displayedFieldValue({ type: 'entityRefArray', default: ['a'] }, {}, 'panels')).toEqual([]);
    });

    it('参照でないフィールドは既定値を出す', () => {
        expect(displayedFieldValue({ type: 'number', default: 3 }, {}, 'speed')).toBe(3);
        expect(displayedFieldValue({ type: 'enum', options: ['a', 'b'] }, {}, 'mode')).toBe('a');
    });

    it('プロトタイプのキー（toString など）を data にある値と取り違えない', () => {
        expect(displayedFieldValue({ type: 'entityRef' }, {}, 'toString')).toBeNull();
    });
});
