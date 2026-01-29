'use client';

import getStroke from 'perfect-freehand';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWorld } from '../../../core/contexts/WorldContext';
import { useSocket } from '../../../core/hooks/useSocket';
import type { DrawingData, StrokeData as Stroke } from '../types';

// ============================================
// Types
// ============================================

export interface PenCanvasContextType {
    /**
     * @deprecated Use createEntity('stroke') instead
     */
    addStroke: (stroke: Stroke) => void;
    setCurrentDrawing: (drawing: DrawingData | null) => void;
    setRemoteDrawing: (entityId: string, drawing: DrawingData | null) => void;
    forceUpdate: () => void;
}

// ============================================
// Context
// ============================================

const PenCanvasContext = createContext<PenCanvasContextType | null>(null);

// ============================================
// Utilities
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
// Provider
// ============================================

export const PenCanvasProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket } = useSocket();
    const { entities } = useWorld();
    const currentDrawingRef = useRef<DrawingData | null>(null);
    const remoteDrawingsRef = useRef<Map<string, DrawingData>>(new Map());
    const [, setTick] = useState(0);

    const forceUpdate = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    const addStroke = useCallback((_stroke: Stroke) => {
        console.warn('PenCanvasContext.addStroke is deprecated. Use createEntity("stroke"...) instead.');
    }, []);

    const setCurrentDrawing = useCallback(
        (drawing: DrawingData | null) => {
            currentDrawingRef.current = drawing;
            forceUpdate();
        },
        [forceUpdate],
    );

    const setRemoteDrawing = useCallback(
        (entityId: string, drawing: DrawingData | null) => {
            if (drawing) {
                remoteDrawingsRef.current.set(entityId, drawing);
            } else {
                remoteDrawingsRef.current.delete(entityId);
            }
            forceUpdate();
        },
        [forceUpdate],
    );

    useEffect(() => {
        if (!socket) return;

        const handleEphemeral = (payload: { entityId: string; data: unknown }) => {
            const data = payload.data as DrawingData & { isComplete?: boolean };

            // データ検証
            if (!data || !Array.isArray(data.points)) return;

            if (data.isComplete) {
                // 描画完了：リモート描画を削除
                setRemoteDrawing(payload.entityId, null);
            } else {
                // 描画中：リモート描画を更新
                setRemoteDrawing(payload.entityId, data);
            }
        };

        socket.on('entity:ephemeral', handleEphemeral);
        return () => {
            socket.off('entity:ephemeral', handleEphemeral);
        };
    }, [socket, setRemoteDrawing]);

    const contextValue: PenCanvasContextType = useMemo(
        () => ({
            addStroke,
            setCurrentDrawing,
            setRemoteDrawing,
            forceUpdate,
        }),
        [addStroke, setCurrentDrawing, setRemoteDrawing, forceUpdate],
    );

    return (
        <PenCanvasContext.Provider value={contextValue}>
            {children}
            {/* Pen Canvas SVG */}
            <svg
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    pointerEvents: 'none',
                    zIndex: 50,
                }}
            >
                {/* 確定済みストローク（WorldContextのエンティティから描画） */}
                {Array.from(entities.values())
                    .filter((e) => e.type === 'stroke')
                    .map((entity) => {
                        const stroke = entity.data as unknown as Stroke;
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

                {/* 自分の描画中ストローク */}
                {currentDrawingRef.current && currentDrawingRef.current.points.length > 0 && (
                    <path
                        d={getSvgPathFromStroke(
                            getStroke(
                                currentDrawingRef.current.points,
                                getStrokeOptions(currentDrawingRef.current.size),
                            ),
                        )}
                        fill={currentDrawingRef.current.color}
                    />
                )}
            </svg>
        </PenCanvasContext.Provider>
    );
};

export const usePenCanvas = () => {
    const context = useContext(PenCanvasContext);
    if (!context) {
        throw new Error('usePenCanvas must be used within PenCanvasProvider');
    }
    return context;
};
