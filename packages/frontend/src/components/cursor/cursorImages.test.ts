// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyCursorStyles, removeCursorStyles } from './cursorImages';

describe('ride cursor styles', () => {
    afterEach(removeCursorStyles);

    it('搭乗中はnative cursorを隠す', () => {
        applyCursorStyles(null, true);
        expect(document.getElementById('ubichill-cursor-style')?.textContent).toContain('cursor: none !important');
    });

    it('降車後は通常のcursorへ戻す', () => {
        applyCursorStyles(null, true);
        applyCursorStyles(null, false);
        const css = document.getElementById('ubichill-cursor-style')?.textContent;
        expect(css).toContain('body {');
        expect(css).not.toContain('cursor: none !important');
    });
});
