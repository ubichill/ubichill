/**
 * useCursorPosition
 *
 * カーソルオーバーレイ要素の位置を React state を使わず直接 DOM 操作で更新するフック。
 * `onCursorUpdate` を呼ぶだけで 0 re-render/秒 のままカーソルが動く。
 *
 * ## アルゴリズム: DOM 直接書き込み（re-render ゼロ）
 *
 * React state の `setState` は次の render まで DOM 更新を遅延させる。
 * 60fps（16ms/frame）のカーソル更新では、setState → re-render → reconcile の
 * コストが無視できない。
 * divRef.current.style.transform を直接書き換えることで、
 * React のライフサイクルを完全にバイパスし O(1) で更新する。
 *
 * - 初期状態: visibility: hidden（座標未取得時は非表示）
 * - 初回 onCursorUpdate 呼び出し時: visibility: visible に切り替え
 * - hotspot: カーソル画像の原点オフセット（左上起点のピクセル）
 */

'use client';

import { type RefObject, useCallback, useRef } from 'react';

export type UseCursorPositionOptions = {
    hotspot?: { x: number; y: number };
};

export function useCursorPosition({ hotspot = { x: 0, y: 0 } }: UseCursorPositionOptions = {}): {
    divRef: RefObject<HTMLDivElement | null>;
    onCursorUpdate: (x: number, y: number) => void;
} {
    const divRef = useRef<HTMLDivElement>(null);
    const hotspotRef = useRef(hotspot);
    hotspotRef.current = hotspot;

    const onCursorUpdate = useCallback((x: number, y: number) => {
        const el = divRef.current;
        if (!el) return;
        const { x: hx, y: hy } = hotspotRef.current;
        el.style.transform = `translate3d(${x - hx - window.scrollX}px, ${y - hy - window.scrollY}px, 0)`;
        if (el.style.visibility === 'hidden') el.style.visibility = 'visible';
    }, []);

    return { divRef, onCursorUpdate };
}
