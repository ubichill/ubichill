import type { ModHostEvent, VNode } from '@ubichill/shared';
import { useCallback, useRef, useState } from 'react';

/**
 * Worker が Ubi.ui.render() / Ubi.ui.unmount() したときの VNode 状態を管理する。
 *
 * 使い方:
 * ```tsx
 * const { vnodes, onRender, sendAction, sendEventRef } = useModUI();
 * const { sendEvent } = useModWorker({ ..., handlers: { onRender } });
 * sendEventRef.current = sendEvent; // レンダー中の ref 同期（副作用なし）
 *
 * // JSX 内:
 * {[...vnodes.entries()].map(([targetId, vnode]) => (
 *   <ModUIMount key={targetId} targetId={targetId} vnode={vnode} sendAction={sendAction} />
 * ))}
 * ```
 */
export function useModUI() {
    const [vnodes, setVnodes] = useState<Map<string, VNode | null>>(() => new Map());

    /**
     * sendEvent を外から注入するための ref。
     * useModWorker の sendEvent を代入することで EVT_UI_ACTION が送れる。
     */
    const sendEventRef = useRef<((event: ModHostEvent) => void) | null>(null);

    /** useModWorker の handlers.onRender に渡す */
    const onRender = useCallback((targetId: string, vnode: VNode | null) => {
        setVnodes((prev) => {
            const next = new Map(prev);
            if (vnode === null) {
                next.delete(targetId);
            } else {
                next.set(targetId, vnode);
            }
            return next;
        });
    }, []);

    /**
     * ModUIMount の sendAction に渡す。
     * targetId を閉じ込めた状態で EVT_UI_ACTION を Worker へ送る。
     */
    const sendAction = useCallback((targetId: string, handlerIndex: number, eventType: string, detail?: unknown) => {
        sendEventRef.current?.({
            type: 'EVT_UI_ACTION',
            payload: { targetId, handlerIndex, eventType, detail },
        });
    }, []);

    return { vnodes, onRender, sendAction, sendEventRef };
}
