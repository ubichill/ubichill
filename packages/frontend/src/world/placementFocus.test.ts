// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { placementFocus } from './placementFocus';

function setup(html: string): HTMLElement {
    document.body.innerHTML = html;
    const layer = document.querySelector<HTMLElement>('[data-layer]');
    if (!layer) throw new Error('layer');
    return layer;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('placementFocus', () => {
    it('置く画面の中にフォーカスがあれば layer', () => {
        const layer = setup(
            '<div data-layer role="dialog" aria-modal="true" tabindex="-1"><button>やめる</button></div>',
        );
        document.querySelector('button')?.focus();
        expect(placementFocus(layer, document)).toBe('layer');
        layer.focus();
        expect(placementFocus(layer, document)).toBe('layer');
    });

    it('トーストのボタン・body に出たら取り返す', () => {
        const layer = setup(
            '<div data-layer role="dialog" tabindex="-1"></div><div role="status"><button>閉じる</button></div>',
        );
        document.querySelector('button')?.focus();
        expect(placementFocus(layer, document)).toBe('reclaim');
        (document.activeElement as HTMLElement).blur();
        expect(placementFocus(layer, document)).toBe('reclaim');
    });

    it('確認・権限のダイアログが出ていれば、フォーカスが無くても譲る', () => {
        const layer = setup(
            '<div data-layer role="dialog" tabindex="-1"></div><div role="alertdialog" aria-modal="true"><button>OK</button></div>',
        );
        expect(placementFocus(layer, document)).toBe('dialog');
        document.querySelector('button')?.focus();
        expect(placementFocus(layer, document)).toBe('dialog');
    });

    it('mod の面の中のダイアログには譲らない', () => {
        const layer = setup(
            '<div data-ubi-mod-surface><div role="dialog"><button>mod</button></div></div><div data-layer role="dialog" tabindex="-1"></div>',
        );
        document.querySelector('button')?.focus();
        expect(placementFocus(layer, document)).toBe('reclaim');
    });

    it('置く画面を囲む・置く画面の中のダイアログは数えない', () => {
        const layer = setup(
            '<div role="dialog"><div data-layer role="dialog" tabindex="-1"><div aria-modal="true"></div></div></div>',
        );
        layer.focus();
        expect(placementFocus(layer, document)).toBe('layer');
    });
});
