// @vitest-environment jsdom
import type { VNode, VNodeChild } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderVNode } from './VNodeRenderer';

function searchInput(value: string): VNode {
    return {
        type: 'input',
        props: { type: 'search', value, onUbiInput: '__h0' },
        children: [],
    };
}

describe('VNodeRenderer: テキスト入力', () => {
    it('空白を含む入力値をそのまま Worker へ渡し、応答前の再描画でも消さない', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const sendAction = vi.fn();
        renderVNode(searchInput('lo'), container, sendAction);
        const input = container.querySelector('input');
        if (!input) throw new Error('input がない');

        input.focus();
        input.value = 'lo fi';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Worker の state 更新より先に古い VNode が届く状況を再現する。
        renderVNode(searchInput('lo'), container, sendAction);

        expect(sendAction).toHaveBeenCalledWith(0, 'input', 'lo fi');
        expect(input.value).toBe('lo fi');
        expect(document.activeElement).toBe(input);
        container.remove();
    });
});

/** ModUIMount と同じく Shadow DOM の中に描く。 */
function renderInShadow(vnode: VNode): { container: HTMLElement; shadow: ShadowRoot; dispose: () => void } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.appendChild(container);
    renderVNode(vnode, container, vi.fn());
    return { container, shadow, dispose: () => host.remove() };
}

const field = (type: string, value: string, children: VNode['children'] = []): VNode => ({
    type,
    props: { value, onUbiInput: '__h0' },
    children,
});

const options = ['a', 'b', 'c'].map((v): VNode => ({ type: 'option', props: { value: v }, children: [v] }));

describe('VNodeRenderer: Shadow DOM の中の入力欄', () => {
    it.each(['input', 'textarea'])(
        'フォーカス中の <%s> は、Worker から遅れて届いた別の値で上書きしない（IME の変換を壊さない）',
        (type) => {
            const { container, shadow, dispose } = renderInShadow(field(type, 'l'));
            const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(type);
            if (!input) throw new Error(`${type} がない`);
            input.focus();
            expect(shadow.activeElement).toBe(input);
            input.value = 'lo fi';
            // ユーザーが 'lo fi' まで打った後に、'lo' の時点の VNode が届く
            renderVNode(field(type, 'lo'), container, vi.fn());
            expect(input.value).toBe('lo fi');
            dispose();
        },
    );

    it.each(['input', 'textarea'])('フォーカスしていない <%s> には新しい値を反映する', (type) => {
        const { container, dispose } = renderInShadow(field(type, 'first'));
        const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(type);
        expect(input?.value).toBe('first');
        renderVNode(field(type, 'second'), container, vi.fn());
        expect(input?.value).toBe('second');
        dispose();
    });

    it('<select> の value は初回から選択に反映し、変わったら選び直す', () => {
        const { container, dispose } = renderInShadow(field('select', 'b', options));
        const select = container.querySelector('select');
        expect(select?.value).toBe('b');
        renderVNode(field('select', 'c', options), container, vi.fn());
        expect(select?.value).toBe('c');
        dispose();
    });

    it('<select> を選び直した後、同じ value の VNode が来ても選択を戻さない', () => {
        const { container, dispose } = renderInShadow(field('select', 'a', options));
        const select = container.querySelector('select');
        if (!select) throw new Error('select がない');
        select.value = 'c';
        renderVNode(field('select', 'a', options), container, vi.fn());
        expect(select.value).toBe('c');
        dispose();
    });
});

function render(vnode: VNode): { container: HTMLElement; sendAction: ReturnType<typeof vi.fn> } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const sendAction = vi.fn();
    renderVNode(vnode, container, sendAction);
    return { container, sendAction };
}

const el = (type: string, props: VNode['props'], children: VNode['children'] = []): VNode => ({
    type,
    props,
    children,
});

describe('VNodeRenderer: mod から届いた値で Host を操作させない', () => {
    it('SVG にもイベント属性を付けない（HTML と同じ規則）', () => {
        const { container } = render(
            el('svg', { onclick: 'globalThis.__pwned = true', onload: 'x' }, [
                el('circle', { onclick: 'globalThis.__pwned = true', cx: 1, cy: 2, r: 3 }),
            ]),
        );
        const svg = container.querySelector('svg');
        const circle = container.querySelector('circle');
        expect(svg?.getAttribute('onclick')).toBeNull();
        expect(svg?.getAttribute('onload')).toBeNull();
        expect(circle?.getAttribute('onclick')).toBeNull();
        expect(circle?.getAttribute('r')).toBe('3');
        circle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it('SVG の参照・塗りで外部を読ませない', () => {
        const { container } = render(
            el('svg', {}, [
                el('use', { href: 'https://attacker.example/s.svg#a' }),
                el('rect', { fill: 'url(https://attacker.example/x)', stroke: 'url(#g)', style: 'fill: red' }),
            ]),
        );
        expect(container.querySelector('use')?.getAttribute('href')).toBeNull();
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('fill')).toBeNull();
        expect(rect?.getAttribute('stroke')).toBe('url(#g)');
        expect(rect?.getAttribute('style') ?? '').not.toContain('fill');
    });

    it('スタイルの url() は捨て、ほかの宣言は残す', () => {
        const { container } = render(
            el('div', { style: { backgroundImage: 'url(https://attacker.example/?q=1)', color: 'red' } }),
        );
        const div = container.querySelector('div');
        expect(div?.style.backgroundImage).toBe('');
        expect(div?.style.color).toBe('red');
    });

    it('リンクは別タブ・opener なしで開く', () => {
        const { container } = render(el('a', { href: 'https://example.com/' }, ['x']));
        const a = container.querySelector('a');
        expect(a?.getAttribute('target')).toBe('_blank');
        expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('javascript: のリンクは付けない', () => {
        const { container } = render(el('a', { href: 'javascript:alert(1)' }, ['x']));
        expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
    });

    it('フォームを送信しても Host のページを遷移させない', () => {
        const { container } = render(
            el('form', {}, [el('input', { name: 'url', value: 'https://attacker.example/w.yaml' })]),
        );
        const form = container.querySelector('form');
        const submit = new Event('submit', { cancelable: true });
        form?.dispatchEvent(submit);
        expect(submit.defaultPrevented).toBe(true);
    });

    it('パスワード欄は描かない', () => {
        const { container } = render(el('input', { type: 'password', name: 'password' }));
        expect(container.querySelector('input')?.type).toBe('text');
    });
});

/** mod は VNode を自由に作れる。型に合わない値も届く前提で描く。 */
const untrusted = (value: unknown): VNode => value as VNode;

/** `depth` 段の div の入れ子（再帰を使わずに作る）。一番内側に文字を置く。 */
function nestedDivs(depth: number): VNode {
    return Array.from({ length: depth - 1 }).reduce<VNode>(
        (inner) => el('div', {}, [inner]),
        el('div', {}, ['deepest']),
    );
}

const depthOf = (root: Element): number => {
    const walk = (node: Element, depth: number): number =>
        Math.max(depth, ...Array.from(node.children).map((child) => walk(child, depth + 1)));
    return walk(root, 0);
};

describe('VNodeRenderer: 型に合わない VNode でも例外を出さない', () => {
    it.each([
        ['props が null', { type: 'div', props: null, children: ['x'] }],
        ['props が無い', { type: 'div', children: ['x'] }],
        ['props が数値', { type: 'div', props: 7, children: ['x'] }],
        ['props が配列', { type: 'div', props: ['a'], children: ['x'] }],
    ])('%s なら属性なしで描く', (_, vnode) => {
        const { container } = render(untrusted(vnode));
        const div = container.querySelector('div');
        expect(div?.textContent).toBe('x');
        expect(div?.getAttributeNames().filter((name) => name !== 'style')).toEqual([]);
    });

    it('文字列にできない属性・スタイルの値（toString が関数でない）は捨て、ほかは残す', () => {
        const { container } = render(
            untrusted({
                type: 'div',
                props: { title: { toString: 1 }, id: 'kept', style: { color: { toString: 1 }, opacity: 0.5 } },
                children: [],
            }),
        );
        const div = container.querySelector('div');
        expect(div?.hasAttribute('title')).toBe(false);
        expect(div?.id).toBe('kept');
        expect(div?.style.color).toBe('');
        expect(div?.style.opacity).toBe('0.5');
    });

    it.each([
        ['数値', 7],
        ['文字列', 'abc'],
        ['オブジェクト', { length: 3 }],
        ['null', null],
        ['無い', undefined],
    ])('children が%sなら子なしで描く', (_, children) => {
        const { container } = render(untrusted({ type: 'p', props: {}, children }));
        expect(container.querySelector('p')?.childNodes).toHaveLength(0);
    });

    it('子の中の型の違う値（type の無いオブジェクト・数値の type）は描かずに兄弟は残す', () => {
        const { container } = render(
            untrusted({
                type: 'ul',
                props: {},
                children: [{}, { type: 42 }, { type: 'li', props: {}, children: ['ok'] }],
            }),
        );
        expect(container.querySelectorAll('li')).toHaveLength(1);
        expect(container.textContent).toBe('ok');
    });

    it('Fragment の props・children が壊れていても描く', () => {
        const { container } = render(untrusted({ type: 'ubichill:fragment', props: null, children: 3 }));
        expect(container.childNodes).toHaveLength(0);
        const nested = render(
            untrusted({
                type: 'div',
                props: {},
                children: [{ type: 'ubichill:fragment', props: null, children: null }, 'after'],
            }),
        );
        expect(nested.container.textContent).toBe('after');
    });

    it('20000 段の入れ子は上限の深さで切り、浅い兄弟は残す', () => {
        const { container } = render(el('section', {}, [nestedDivs(20_000), el('span', {}, ['sibling'])]));
        const section = container.querySelector('section');
        if (!section) throw new Error('section がない');
        expect(depthOf(container)).toBeLessThanOrEqual(32);
        expect(container.textContent).not.toContain('deepest');
        expect(section.querySelector(':scope > span')?.textContent).toBe('sibling');
    });

    it('上限ちょうどの深さは描く', () => {
        const { container } = render(nestedDivs(32));
        expect(depthOf(container)).toBe(32);
        expect(container.textContent).toBe('deepest');
    });

    it('20000 段の配列・Fragment の入れ子でも例外を出さない', () => {
        const deepArray = Array.from({ length: 20_000 }).reduce<VNodeChild>((inner) => [inner], 'leaf');
        const deepFragment = Array.from({ length: 20_000 }).reduce<VNodeChild>(
            (inner) => ({ type: 'ubichill:fragment', props: {}, children: [inner] }),
            'leaf',
        );
        expect(render(el('div', {}, [deepArray, 'tail'])).container.textContent).toBe('tail');
        expect(render(el('div', {}, [deepFragment, 'tail'])).container.textContent).toBe('tail');
    });

    it('壊れた VNode の後に正しい VNode が来れば描き直せる', () => {
        const container = document.createElement('div');
        const sendAction = vi.fn();
        renderVNode(untrusted({ type: 'div', props: null, children: 7 }), container, sendAction);
        renderVNode(el('div', { title: 't' }, ['ok']), container, sendAction);
        expect(container.querySelector('div')?.getAttribute('title')).toBe('t');
        expect(container.textContent).toBe('ok');
    });
});
