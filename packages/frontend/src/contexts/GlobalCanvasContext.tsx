'use client';

import getStroke from 'perfect-freehand';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useWorld } from './WorldContext';

// ============================================
// Types
// ============================================

export interface Stroke {
    points: number[][];
    color: string;
    size: number;
}

export interface DrawingData {
    points: number[][];
    color: string;
    size: number;
}

export interface GlobalCanvasContextType {
    addStroke: (stroke: Stroke) => void;
    setCurrentDrawing: (drawing: DrawingData | null) => void;
    setRemoteDrawing: (entityId: string, drawing: DrawingData | null) => void;
    forceUpdate: () => void;
}

// ============================================
// Context
// ============================================

const GlobalCanvasContext = createContext<GlobalCanvasContextType | null>(null);

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

export const GlobalCanvasProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket } = useSocket();
    const { entities } = useWorld();
    // const strokesRef = useRef<Stroke[]>([]); // 廃止: entitiesから直接描画
    const currentDrawingRef = useRef<DrawingData | null>(null);
    const remoteDrawingsRef = useRef<Map<string, DrawingData>>(new Map());
    const [, setTick] = useState(0);

    const forceUpdate = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    const addStroke = useCallback((stroke: Stroke) => {
        // strokesRef.current = [...strokesRef.current, stroke];
        // forceUpdate();
        // 廃止: ストロークは WorldContext 経由で追加されるため、ここは使わない
        console.warn('GlobalCanvasContext.addStroke is deprecated. Use createEntity("stroke"...) instead.');
    }, []);

    const setCurrentDrawing = useCallback((drawing: DrawingData | null) => {
        currentDrawingRef.current = drawing;
        forceUpdate();
    }, [forceUpdate]);

    const setRemoteDrawing = useCallback((entityId: string, drawing: DrawingData | null) => {
        if (drawing) {
            remoteDrawingsRef.current.set(entityId, drawing);
        } else {
            remoteDrawingsRef.current.delete(entityId);
        }
        forceUpdate();
    }, [forceUpdate]);

    useEffect(() => {
        if (!socket) return;

        const handleStream = (payload: { entityId: string; data: DrawingData & { isComplete?: boolean } }) => {
            // データ検証
            if (!payload.data || !Array.isArray(payload.data.points)) return;

            if (payload.data.isComplete) {
                // 描画完了：リモート描画を削除
                // ストロークの保存は送信者が createEntity を行うので、ここでは何もしない
                // （二重描画を防ぐため）
                setRemoteDrawing(payload.entityId, null);
            } else {
                // 描画中：リモート描画を更新
                setRemoteDrawing(payload.entityId, payload.data);
            }
        };

        (socket as any).on('entity:stream', handleStream);
        return () => {
            (socket as any).off('entity:stream', handleStream);
        };
    }, [socket, addStroke, setRemoteDrawing]);

    const contextValue: GlobalCanvasContextType = useMemo(() => ({
        addStroke,
        setCurrentDrawing,
        setRemoteDrawing,
        forceUpdate,
    }), [addStroke, setCurrentDrawing, setRemoteDrawing, forceUpdate]);

    return (
        <GlobalCanvasContext.Provider value={contextValue}>
            {children}
            {/* Global Canvas SVG */}
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
                        d={getSvgPathFromStroke(getStroke(currentDrawingRef.current.points, getStrokeOptions(currentDrawingRef.current.size)))}
                        fill={currentDrawingRef.current.color}
                    />
                )}
            </svg>
        </GlobalCanvasContext.Provider>
    );
};

export const useGlobalCanvas = () => {
    const context = useContext(GlobalCanvasContext);
    if (!context) {
        throw new Error('useGlobalCanvas must be used within GlobalCanvasProvider');
    }
    return context;
};
