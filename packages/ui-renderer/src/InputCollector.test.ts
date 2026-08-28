// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { InputCollector } from './InputCollector';

/**
 * jsdom は PointerEvent を実装していないため、必要な範囲だけ MouseEvent で代用する。
 * `pointerType` は InputCollector が読む唯一の PointerEvent 固有プロパティ。
 */
function pointerDown(target: Element, pointerType: 'mouse' | 'pen' | 'touch', clientX = 10, clientY = 10): void {
    const e = new MouseEvent('pointerdown', { bubbles: true, clientX, clientY });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    target.dispatchEvent(e);
}

function pointerMove(target: Element, clientX: number, clientY: number): void {
    const e = new MouseEvent('pointermove', { bubbles: true, clientX, clientY, buttons: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'touch' });
    target.dispatchEvent(e);
}

/** jsdom はレイアウトを持たないので scrollLeft/Top を差し替えたスクロール要素を作る。 */
function makeScrollEl(scrollLeft: number, scrollTop: number): Element {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
    document.body.appendChild(el);
    return el;
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
    // jsdom は elementFromPoint を実装していない。CURSOR_STYLE 検出でのみ使われるので、
    // 座標変換のテストでは「直下に要素なし」を返すスタブで十分。
    document.elementFromPoint = () => null;
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

// ワールドがスクロールされている状態で「クリックした場所」と「描かれる場所」が一致するかは
// この座標変換だけで決まる。ここが崩れると、スクロール量だけずれた位置に線が描かれる。
describe('InputCollector: ワールド座標への変換（スクロール量の加算）', () => {
    it('スクロール要素を登録すると x/y にスクロール量が乗り、viewportX/Y は素の座標のまま', () => {
        const div = setup('<div>world</div>');
        collector?.setScrollElement(makeScrollEl(300, 120));

        pointerDown(div, 'touch', 40, 50);
        const { events } = collector?.collectSince(0) ?? { events: [] };
        const down = events.find((ev) => ev.type === 'MOUSE_DOWN');
        expect(down?.data).toMatchObject({ x: 340, y: 170, viewportX: 40, viewportY: 50 });
    });

    it('MOUSE_MOVE も同じ変換を通る（ストロークの各点がずれない）', () => {
        const div = setup('<div>world</div>');
        collector?.setScrollElement(makeScrollEl(300, 120));

        pointerMove(div, 40, 50);
        const { events } = collector?.collectSince(0) ?? { events: [] };
        const move = events.find((ev) => ev.type === 'MOUSE_MOVE');
        expect(move?.data).toMatchObject({ x: 340, y: 170, viewportX: 40, viewportY: 50 });
    });

    it('スクロール要素が未登録だとスクロール量が 0 扱いになる（登録漏れが座標ずれになる）', () => {
        const div = setup('<div>world</div>');
        pointerDown(div, 'touch', 40, 50);
        const { events } = collector?.collectSince(0) ?? { events: [] };
        const down = events.find((ev) => ev.type === 'MOUSE_DOWN');
        // ワールド座標がビューポート座標と同じになってしまう = スクロール分ずれる
        expect(down?.data).toMatchObject({ x: 40, y: 50 });
    });

    it('登録を外すとスクロール量の加算も止まる', () => {
        const div = setup('<div>world</div>');
        collector?.setScrollElement(makeScrollEl(300, 120));
        collector?.setScrollElement(null);

        pointerDown(div, 'touch', 40, 50);
        const { events } = collector?.collectSince(0) ?? { events: [] };
        expect(events.find((ev) => ev.type === 'MOUSE_DOWN')?.data).toMatchObject({ x: 40, y: 50 });
    });
});
