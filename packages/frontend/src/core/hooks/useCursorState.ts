'use client';

import type { CursorState } from '@ubichill/shared';
import { useEffect, useState } from 'react';

/**
 * 現在のカーソル状態（CSS cursorプロパティベース）を検知するフック
 */
export const useCursorState = (): CursorState => {
    const [cursorState, setCursorState] = useState<CursorState>('default');

    useEffect(() => {
        let lastElement: Element | null = null;

        const checkCursor = (e: MouseEvent) => {
            const target = e.target as Element;
            if (!target || target === lastElement) return;
            lastElement = target;

            // Computed Styleからcursorを取得
            const style = window.getComputedStyle(target);
            const cursor = style.cursor;

            let newState: CursorState = 'default';

            // cursor: noneの場合は要素から推測する
            if (cursor === 'none' || cursor === 'auto') {
                // 親要素を遡ってインタラクティブな要素を探す
                let current: Element | null = target;
                while (current) {
                    const tagName = current.tagName.toLowerCase();
                    const role = current.getAttribute('role');
                    const type = current.getAttribute('type');
                    const contentEditable = current.getAttribute('contenteditable');

                    if (
                        tagName === 'a' ||
                        tagName === 'button' ||
                        role === 'button' ||
                        role === 'link' ||
                        current.hasAttribute('onclick')
                    ) {
                        newState = 'pointer';
                        break;
                    } else if (
                        (tagName === 'input' &&
                            (type === 'text' || type === 'email' || type === 'password' || !type)) ||
                        tagName === 'textarea' ||
                        contentEditable === 'true'
                    ) {
                        newState = 'text';
                        break;
                    } else if (window.getComputedStyle(current).cursor === 'pointer') {
                        // 親要素が明示的にpointerを持っている場合（ただしnoneで上書きされていると取れないので、これは補助的）
                        newState = 'pointer';
                        break;
                    }

                    // 探索範囲を限定（bodyまで行ったら終わり）
                    if (current === document.body) break;
                    current = current.parentElement;
                }
            } else {
                // 明示的なカーソル指定がある場合（none以外）
                if (cursor === 'pointer') newState = 'pointer';
                else if (cursor === 'text') newState = 'text';
                else if (cursor === 'wait' || cursor === 'progress') newState = 'wait';
                else if (cursor === 'help') newState = 'help';
                else if (cursor === 'not-allowed' || cursor === 'no-drop') newState = 'not-allowed';
                else if (cursor === 'move') newState = 'move';
                else if (cursor === 'grabbing') newState = 'grabbing';
            }

            setCursorState(newState);
        };

        // mousemoveは頻度が高いので、実際にはmouseover/mouseoutで十分かもしれないが
        // computed styleが変わる可能性もあるのでmousemoveで検知
        // パフォーマンスのためにthrottleするか、mouseoverを使う
        // ここでは一旦 mouseover を使用
        const handleMouseOver = (e: MouseEvent) => {
            checkCursor(e);
        };

        window.addEventListener('mouseover', handleMouseOver);

        return () => {
            window.removeEventListener('mouseover', handleMouseOver);
        };
    }, []);

    return cursorState;
};
