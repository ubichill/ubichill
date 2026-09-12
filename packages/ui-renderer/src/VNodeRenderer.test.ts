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
