import { describe, expect, it } from 'vitest';
import { createDialogStack, isCloseKey } from './dialogLayer';

describe('createDialogStack', () => {
    it('Esc を受け取るのは一番手前だけ。閉じると次が手前になる', () => {
        const stack = createDialogStack();
        const detail = Symbol('detail');
        const confirm = Symbol('confirm');
        stack.open(detail);
        stack.open(confirm);
        expect(stack.isTop(confirm)).toBe(true);
        expect(stack.isTop(detail)).toBe(false);
        stack.close(confirm);
        expect(stack.isTop(detail)).toBe(true);
    });

    it('奥のダイアログが先に閉じても、手前は手前のまま（順番が崩れない）', () => {
        const stack = createDialogStack();
        const [a, b, c] = [Symbol('a'), Symbol('b'), Symbol('c')];
        stack.open(a);
        stack.open(b);
        stack.open(c);
        stack.close(a);
        expect(stack.isTop(c)).toBe(true);
        expect(stack.size).toBe(2);
    });

    it('同じダイアログを 2 回開いても 1 枚、知らないものを閉じても壊れない', () => {
        const stack = createDialogStack();
        const a = Symbol('a');
        stack.open(a);
        stack.open(a);
        stack.close(Symbol('other'));
        expect(stack.size).toBe(1);
        stack.close(a);
        expect(stack.size).toBe(0);
        expect(stack.isTop(a)).toBe(false);
    });
});

describe('isCloseKey', () => {
    it('Esc で閉じる。変換中の Esc（isComposing・229）では閉じない', () => {
        expect(isCloseKey({ key: 'Escape', isComposing: false, keyCode: 27 })).toBe(true);
        expect(isCloseKey({ key: 'Escape', isComposing: true, keyCode: 27 })).toBe(false);
        expect(isCloseKey({ key: 'Escape', isComposing: false, keyCode: 229 })).toBe(false);
        expect(isCloseKey({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(false);
    });
});
