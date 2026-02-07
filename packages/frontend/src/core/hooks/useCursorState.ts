'use client';

import type { CursorState } from '@ubichill/shared';
import { useEffect, useState } from 'react';

/**
 * 現在のカーソル状態（CSS cursorプロパティベース）を検知するフック
 */
export const useCursorState = (): CursorState => {
    const [cursorState, setCursorState] = useState<CursorState>('default');

    useEffect(() => {
        let rafId: number = 0;
        let lastElement: Element | null = null;

        const checkCursor = (e: MouseEvent) => {
            const target = e.target as Element;
            if (!target || target === lastElement) return;
            lastElement = target;

            // Computed Styleからcursorを取得
            const style = window.getComputedStyle(target);
            const cursor = style.cursor;

            let newState: CursorState = 'default';

            if (cursor === 'pointer') newState = 'pointer';
            else if (cursor === 'text') newState = 'text';
            else if (cursor === 'wait' || cursor === 'progress') newState = 'wait';
            else if (cursor === 'help') newState = 'help';
            else if (cursor === 'not-allowed' || cursor === 'no-drop') newState = 'not-allowed';
            else if (cursor === 'move') newState = 'move';
            else if (cursor === 'grabbing') newState = 'grabbing';
            else if (cursor === 'auto') {
                // autoの場合、タグ名や属性から推測
                const tagName = target.tagName.toLowerCase();
                const role = target.getAttribute('role');
                const type = target.getAttribute('type');

                if (tagName === 'a' || tagName === 'button' || role === 'button') {
                    newState = 'pointer';
                } else if (
                    tagName === 'input' &&
                    (type === 'text' || type === 'email' || type === 'password' || !type)
                ) {
                    newState = 'text';
                } else if (tagName === 'textarea') {
                    newState = 'text';
                }
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
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    return cursorState;
};
