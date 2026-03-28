import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import { UbiSingleton } from '@ubichill/sdk/ui';
import getStroke from 'perfect-freehand';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import type { DrawingData, StrokeData } from './types';

// ============================================
// Stroke utility
// ============================================

const getStrokeOptions = (size: number) => ({
    size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t: number) => t,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
});

function getSvgPathFromStroke(stroke: number[][]): string {
    if (!stroke.length) return '';
    const d = stroke.reduce(
        (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            return acc;
        },
        ['M', ...stroke[0], 'Q'] as (string | number)[],
    );
    d.push('Z');
    return d.join(' ');
}

// ============================================
// React コンテンツ
// ============================================

const PenCanvasContent: React.FC<{ ctx: UbiInstanceContext }> = ({ ctx }) => {
    const { entities, socket } = ctx;
    const [, setTick] = useState(0);
    const currentDrawingRef = useRef<DrawingData | null>(null);
    const remoteDrawingsRef = useRef<Map<string, DrawingData>>(new Map());

    const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

    // ローカル描画中のストローク更新（PenWidgetElement からのイベント）
    useEffect(() => {
        const handler = (e: Event) => {
            const { entityId, drawing } = (e as CustomEvent<{ entityId: string; drawing: DrawingData | null }>).detail;
            if (drawing === null) {
                currentDrawingRef.current = null;
            } else {
                currentDrawingRef.current = drawing;
            }
            forceUpdate();
            // ローカル描画データをブロードキャスト（リモートユーザーへ）
            if (drawing !== null) {
                socket?.emit('entity:ephemeral', { entityId, data: drawing });
            }
        };
        document.addEventListener('ubi:pen-drawing', handler);
        return () => document.removeEventListener('ubi:pen-drawing', handler);
    }, [socket, forceUpdate]);

    // リモートユーザーの描画中ストロークを受信
    useEffect(() => {
        if (!socket) return;

        const handleEphemeral = (payload: { entityId: string; data: unknown }) => {
            const data = payload.data as DrawingData & { isComplete?: boolean };
            if (!data || !Array.isArray(data.points)) return;

            if (data.isComplete) {
                remoteDrawingsRef.current.delete(payload.entityId);
            } else {
                remoteDrawingsRef.current.set(payload.entityId, data);
            }
            forceUpdate();
        };

        socket.on('entity:ephemeral', handleEphemeral as (...args: unknown[]) => void);
        return () => socket.off('entity:ephemeral', handleEphemeral as (...args: unknown[]) => void);
    }, [socket, forceUpdate]);

    // ワールド切り替え時にリセット
    useEffect(() => {
        if (!socket) return;
        const handleSnapshot = () => {
            currentDrawingRef.current = null;
            remoteDrawingsRef.current = new Map();
            forceUpdate();
        };
        socket.on('world:snapshot', handleSnapshot as (...args: unknown[]) => void);
        return () => socket.off('world:snapshot', handleSnapshot as (...args: unknown[]) => void);
    }, [socket, forceUpdate]);

    const strokes = Array.from(entities.values()).filter((e) => e.type === 'stroke');

    return (
        <svg
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                overflow: 'visible',
                pointerEvents: 'none',
                zIndex: 50,
            }}
        >
            {/* 確定済みストローク */}
            {strokes.map((entity) => {
                const stroke = entity.data as unknown as StrokeData;
                return (
                    <path
                        key={entity.id}
                        d={getSvgPathFromStroke(getStroke(stroke.points, getStrokeOptions(stroke.size)))}
                        fill={stroke.color}
                    />
                );
            })}

            {/* リモートユーザーの描画中ストローク */}
            {Array.from(remoteDrawingsRef.current.entries()).map(([id, drawing]) => (
                <path
                    key={`remote-${id}`}
                    d={getSvgPathFromStroke(getStroke(drawing.points, getStrokeOptions(drawing.size)))}
                    fill={drawing.color}
                    opacity={0.6}
                />
            ))}

            {/* ローカルの描画中ストローク */}
            {currentDrawingRef.current && currentDrawingRef.current.points.length > 0 && (
                <path
                    d={getSvgPathFromStroke(
                        getStroke(currentDrawingRef.current.points, getStrokeOptions(currentDrawingRef.current.size)),
                    )}
                    fill={currentDrawingRef.current.color}
                />
            )}
        </svg>
    );
};

// ============================================
// Custom Element
// ============================================

export class PenCanvasElement extends UbiSingleton {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiInstanceContext) {
        this.#root?.render(<PenCanvasContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
