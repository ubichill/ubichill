'use client';

import { usePluginWorker } from '@ubichill/sdk/react';
import { useEffect, useRef } from 'react';
import { penPluginCode } from './PenBehaviour.gen';
import type { PenPayloads } from './types';

interface PenWorkerProps {
    entityId: string;
    color: string;
    strokeWidth: number;
    onDrawingUpdate: (points: number[][]) => void;
    onStrokeComplete: (strokeData: { points: number[][]; color: string; size: number }) => void;
    onPositionUpdate: (x: number, y: number) => void;
    broadcast?: (data: unknown) => void;
}

export const PenWorker: React.FC<PenWorkerProps> = ({
    entityId,
    color,
    strokeWidth,
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

    usePluginWorker<PenPayloads & { 'cursor:position': { x: number; y: number } }>({
        pluginCode: penPluginCode,
        pluginId: `pen:${entityId.slice(0, 8)}`,
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
                    onDrawingUpdateRef.current([]);
                } else if (msg.type === 'DRAWING_CLEAR') {
                    onDrawingUpdateRef.current([]);
                    broadcastRef.current?.({ isComplete: true, points: [], color, size: strokeWidth });
                } else if (msg.type === 'cursor:position') {
                    onPositionUpdateRef.current(msg.payload.x, msg.payload.y);
                }
            },
        },
    });

    return null;
};
