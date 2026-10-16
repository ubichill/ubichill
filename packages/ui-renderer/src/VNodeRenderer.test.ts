// @vitest-environment jsdom
import type { VNode } from '@ubichill/shared';
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
