'use client';

import { usePluginWorker } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';
import { penPluginCode } from './PenBehaviour.gen';
import type { PenWorkerMessage } from './types';

interface PenWorkerProps {
    entityId: string;
    color: string;
    strokeWidth: number;
    isLockedByMe: boolean;
    onDrawingUpdate: (points: number[][]) => void;
    onStrokeComplete: (strokeData: { points: number[][]; color: string; size: number }) => void;
    onPositionUpdate: (x: number, y: number) => void;
    broadcast?: (data: unknown) => void;
}

export const PenWorker: React.FC<PenWorkerProps> = ({
    entityId,
    color,
    strokeWidth,
    isLockedByMe,
    onDrawingUpdate,
    onStrokeComplete,
    onPositionUpdate,
    broadcast,
}) => {
    const onDrawingUpdateRef = useRef(onDrawingUpdate);
    const onStrokeCompleteRef = useRef(onStrokeComplete);
    const onPositionUpdateRef = useRef(onPositionUpdate);
    const broadcastRef = useRef(broadcast);
    const lastBroadcastTimeRef = useRef(0);

    useEffect(() => {
        onDrawingUpdateRef.current = onDrawingUpdate;
        onStrokeCompleteRef.current = onStrokeComplete;
        onPositionUpdateRef.current = onPositionUpdate;
        broadcastRef.current = broadcast;
    }, [onDrawingUpdate, onStrokeComplete, onPositionUpdate, broadcast]);

    const { sendEvent } = usePluginWorker<PenWorkerMessage>({
        pluginCode: penPluginCode,
        pluginId: entityId,
        handlers: {
            onMessage: (msg) => {
                if (msg.type === 'DRAWING_UPDATE') {
                    onDrawingUpdateRef.current(msg.payload.points);
                    const now = Date.now();
                    if (now - lastBroadcastTimeRef.current > 30) {
                        broadcastRef.current?.({ points: msg.payload.points, color, size: strokeWidth });
                        lastBroadcastTimeRef.current = now;
                    }
                } else if (msg.type === 'STROKE_COMPLETE') {
                    onStrokeCompleteRef.current({ points: msg.payload.points, color, size: strokeWidth });
                    broadcastRef.current?.({ isComplete: true, points: msg.payload.points, color, size: strokeWidth });
                    // ストローク完成後にプレビューをクリア（DRAWING_CLEAR を別途送らなくてよい）
                    onDrawingUpdateRef.current([]);
                } else if (msg.type === 'DRAWING_CLEAR') {
                    // 将来の「全消し」操作向け（消しゴムボタンなど）
                    onDrawingUpdateRef.current([]);
                    broadcastRef.current?.({ isComplete: true, points: [], color, size: strokeWidth });
                }
            },
            onCommand: (cmd) => {
                if (cmd.type === 'SCENE_UPDATE_CURSOR') {
                    onPositionUpdateRef.current(cmd.payload.x, cmd.payload.y);
                }
            },
        },
    });

    // 座標系の正規化：
    // 画面の左上を原点(0,0)とした「仮想ワールド（絶対ピクセル）座標」として扱うため、
    // スクロール量を含めたページ上の絶対座標に変換して Behavior に送るようにします。
    useEffect(() => {
        if (!isLockedByMe) return;

        const getAbsoluteCords = (e: MouseEvent) => ({
            x: e.clientX + window.scrollX,
            y: e.clientY + window.scrollY,
        });

        const handleMouseMove = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'MOUSE_MOVE', data: { x, y, buttons: e.buttons } } });
        };
        const handleMouseDown = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'MOUSE_DOWN', data: { x, y, button: e.button } } });
        };
        const handleMouseUp = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'MOUSE_UP', data: { x, y, button: e.button } } });
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isLockedByMe, sendEvent]);

    return null;
};
