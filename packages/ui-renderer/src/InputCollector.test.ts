// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { InputCollector } from './InputCollector';

/**
 * jsdom は PointerEvent を実装していないため、必要な範囲だけ MouseEvent で代用する。
 * `pointerType` は InputCollector が読む唯一の PointerEvent 固有プロパティ。
 */
function pointerDown(target: Element, pointerType: 'mouse' | 'pen' | 'touch'): void {
    const e = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    target.dispatchEvent(e);
}

/** 長押し/右クリックで発火する contextmenu。preventDefault されたかを返す。 */
function contextMenu(target: Element): boolean {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    target.dispatchEvent(e);
    return e.defaultPrevented;
}

let collector: InputCollector | null = null;

function setup(html: string): Element {
    document.body.innerHTML = html;
    collector = new InputCollector();
    const el = document.body.firstElementChild;
    if (!el) throw new Error('テスト対象の要素がない');
    return el;
}

afterEach(() => {
    collector?.destroy();
    collector = null;
    document.body.innerHTML = '';
});

describe('InputCollector: タッチ長押しのコンテキストメニュー抑止', () => {
    // 長押しでネイティブメニューが開くとブラウザが pointercancel を発火し、
    // 指を離していないのに mod 側のボタンが解放されて操作が破綻する。
    it('タッチでボタンを長押ししてもコンテキストメニューを出さない', () => {
        const button = setup('<button type="button">pad</button>');
        pointerDown(button, 'touch');
        expect(contextMenu(button)).toBe(true);
    });

    it('ペンの長押しも同様に抑止する', () => {
        const button = setup('<button type="button">pad</button>');
        pointerDown(button, 'pen');
        expect(contextMenu(button)).toBe(true);
    });

    it('タッチでも背景(mod UI 以外)の長押しは抑止する', () => {
        const div = setup('<div>world</div>');
        pointerDown(div, 'touch');
        expect(contextMenu(div)).toBe(true);
    });

    // 貼り付け等のネイティブメニューはモバイルでも必要なので、テキスト入力欄では残す。
    it('タッチでもテキスト入力欄では抑止しない（貼り付けメニューを残す）', () => {
        const input = setup('<input type="text" />');
        pointerDown(input, 'touch');
        expect(contextMenu(input)).toBe(false);
    });

    it('textarea でも抑止しない', () => {
        const textarea = setup('<textarea></textarea>');
        pointerDown(textarea, 'touch');
        expect(contextMenu(textarea)).toBe(false);
    });

    describe('マウスの右クリックは従来の挙動を保つ', () => {
        it('UI 要素(button)上ではネイティブメニューを残す', () => {
            const button = setup('<button type="button">ui</button>');
            pointerDown(button, 'mouse');
            expect(contextMenu(button)).toBe(false);
        });

        it('背景ではメニューを抑止して mod へ CONTEXT_MENU として流す', () => {
            const div = setup('<div>world</div>');
            pointerDown(div, 'mouse');
            expect(contextMenu(div)).toBe(true);
            const { events } = collector?.collectSince(0) ?? { events: [] };
            expect(events.some((ev) => ev.type === 'CONTEXT_MENU')).toBe(true);
        });
    });

    it('タッチ長押しは CONTEXT_MENU として mod へ流さない（右クリック意図ではない）', () => {
        const div = setup('<div>world</div>');
        pointerDown(div, 'touch');
        contextMenu(div);
        const { events } = collector?.collectSince(0) ?? { events: [] };
        expect(events.some((ev) => ev.type === 'CONTEXT_MENU')).toBe(false);
    });

    it('pointerdown が pointerType を記録するので、マウス→タッチの切替に追従する', () => {
        const button = setup('<button type="button">pad</button>');
        pointerDown(button, 'mouse');
        expect(contextMenu(button)).toBe(false);
        // 同じセッションでタッチに持ち替えたら以降は抑止する
        pointerDown(button, 'touch');
        expect(contextMenu(button)).toBe(true);
    });
});

describe('InputCollector: pointerType の伝播', () => {
    it('MOUSE_DOWN イベントに pointerType を載せる', () => {
        const div = setup('<div>world</div>');
        pointerDown(div, 'touch');
        const { events } = collector?.collectSince(0) ?? { events: [] };
        const down = events.find((ev) => ev.type === 'MOUSE_DOWN');
        expect(down?.data).toMatchObject({ pointerType: 'touch' });
    });

    it('未知の pointerType は mouse に丸める', () => {
        const div = setup('<div>world</div>');
        pointerDown(div, '' as 'mouse');
        const { events } = collector?.collectSince(0) ?? { events: [] };
        const down = events.find((ev) => ev.type === 'MOUSE_DOWN');
        expect(down?.data).toMatchObject({ pointerType: 'mouse' });
    });
});
