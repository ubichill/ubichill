'use client';

import type { EntityTransform, WorldEntity } from '@ubichill/shared';
import getStroke from 'perfect-freehand';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useEntity, useWorld } from '../hooks/useEntity';
import { useSocket } from '../hooks/useSocket';

// ============================================
// Types
// ============================================

/** 確定したストローク */
interface Stroke {
    points: number[][];
    color: string;
    size: number;
}

/** Pen Widget のデータ構造（Reliable） */
interface PenData {
    color: string;
    strokeWidth: number;
    isHeld: boolean;
}

/** Pen Widget のストリームデータ（Volatile） */
interface PenStream {
    currentPoints?: number[][];
    penPosition?: { x: number; y: number };
}

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
// Pen Tool Icon (SVG)
// ============================================

const PenIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 48 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{ filter: 'drop-shadow(2px 2px 3px rgba(0,0,0,0.3))' }}
    >
        <path
            d="M3 21L3.5 17L17 3.5C18.1046 2.39543 19.8954 2.39543 21 3.5C22.1046 4.60457 22.1046 6.39543 21 7.5L7.5 21L3 21Z"
            fill={color}
            stroke="#333"
            strokeWidth="1"
        />
        <path
            d="M3 21L5 19"
            stroke="#333"
            strokeWidth="1.5"
            strokeLinecap="round"
        />
        <path
            d="M15 6L18 9"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1"
            strokeLinecap="round"
        />
    </svg>
);

// ============================================
// Global Canvas Context
// ============================================

interface DrawingData {
    points: number[][];
    color: string;
    size: number;
}

interface GlobalCanvasContextType {
    addStroke: (stroke: Stroke) => void;
    setCurrentDrawing: (drawing: DrawingData | null) => void;
    setRemoteDrawing: (entityId: string, drawing: DrawingData | null) => void;
    forceUpdate: () => void;
}

const GlobalCanvasContext = createContext<GlobalCanvasContextType | null>(null);

export const GlobalCanvasProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const strokesRef = useRef<Stroke[]>([]);
    const currentDrawingRef = useRef<DrawingData | null>(null);
    const remoteDrawingsRef = useRef<Map<string, DrawingData>>(new Map());
    const [, setTick] = useState(0);

    const forceUpdate = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    const addStroke = useCallback((stroke: Stroke) => {
        strokesRef.current = [...strokesRef.current, stroke];
        forceUpdate();
    }, [forceUpdate]);

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

    const contextValue: GlobalCanvasContextType = {
        addStroke,
        setCurrentDrawing,
        setRemoteDrawing,
        forceUpdate,
    };

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
                {/* 確定済みストローク */}
                {strokesRef.current.map((stroke, i) => (
                    <path
                        key={`stroke-${i}`}
                        d={getSvgPathFromStroke(getStroke(stroke.points, getStrokeOptions(stroke.size)))}
                        fill={stroke.color}
                    />
                ))}

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

// ============================================
// Pen Widget Component
// ============================================

interface PenWidgetProps {
    entityId: string;
    initialEntity?: WorldEntity<PenData>;
}

export const PenWidget: React.FC<PenWidgetProps> = ({
    entityId,
    initialEntity,
}) => {
    const { currentUser } = useSocket();
    const globalCanvas = useGlobalCanvas();
    const globalCanvasRef = useRef(globalCanvas);
    globalCanvasRef.current = globalCanvas;
    const { entity, ephemeral, syncState, syncStream, tryLock, unlock, isLockedByMe, isLockedByOther } =
        useEntity<PenData>(entityId, { initialEntity });

    const penRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const currentPointsRef = useRef<number[][]>([]);
    const penPositionRef = useRef({ x: initialEntity?.transform.x ?? 100, y: initialEntity?.transform.y ?? 100 });
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const entityRef = useRef(entity);
    entityRef.current = entity;
    const [, setRenderTrigger] = useState(0);

    // リモートユーザーの描画を更新
    const remoteStream = ephemeral as PenStream | null;
    useEffect(() => {
        if (remoteStream?.currentPoints && remoteStream.currentPoints.length > 0 && entityRef.current) {
            globalCanvasRef.current.setRemoteDrawing(entityId, {
                points: remoteStream.currentPoints,
                color: entityRef.current.data.color,
                size: entityRef.current.data.strokeWidth,
            });
        } else {
            globalCanvasRef.current.setRemoteDrawing(entityId, null);
        }
    }, [remoteStream?.currentPoints, entityId]);

    // リモートからのペン位置更新
    useEffect(() => {
        if (entity && !isDraggingRef.current) {
            penPositionRef.current = { x: entity.transform.x, y: entity.transform.y };
            setRenderTrigger((t) => t + 1);
        }
    }, [entity?.transform.x, entity?.transform.y]);

    // マウスイベントハンドラをuseEffectで登録
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const ent = entityRef.current;
            if (!isDraggingRef.current || !ent) return;

            const newX = e.clientX - dragOffsetRef.current.x;
            const newY = e.clientY - dragOffsetRef.current.y;
            penPositionRef.current = { x: newX, y: newY };

            const point = [e.clientX, e.clientY, 1];
            currentPointsRef.current = [...currentPointsRef.current, point];

            globalCanvasRef.current.setCurrentDrawing({
                points: currentPointsRef.current,
                color: ent.data.color,
                size: ent.data.strokeWidth,
            });

            syncStream({
                currentPoints: currentPointsRef.current,
                penPosition: { x: newX, y: newY },
            });

            setRenderTrigger((t) => t + 1);
        };

        const handleMouseUp = () => {
            const ent = entityRef.current;
            if (!isDraggingRef.current || !ent) return;

            if (currentPointsRef.current.length > 1) {
                globalCanvasRef.current.addStroke({
                    points: currentPointsRef.current,
                    color: ent.data.color,
                    size: ent.data.strokeWidth,
                });
            }

            globalCanvasRef.current.setCurrentDrawing(null);
            currentPointsRef.current = [];
            isDraggingRef.current = false;

            syncState({
                transform: { ...ent.transform, x: penPositionRef.current.x, y: penPositionRef.current.y },
                data: { ...ent.data, isHeld: false },
                lockedBy: null,
            });

            setRenderTrigger((t) => t + 1);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [syncState, syncStream]);

    const handlePenMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (!entity) return;

            e.preventDefault();
            e.stopPropagation();

            if (isLockedByOther) return;
            if (!tryLock()) return;

            const rect = penRef.current?.getBoundingClientRect();
            if (rect) {
                dragOffsetRef.current = {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                };
            }

            isDraggingRef.current = true;
            currentPointsRef.current = [[e.clientX, e.clientY, 1]];
            syncState({ data: { ...entity.data, isHeld: true } });
            setRenderTrigger((t) => t + 1);
        },
        [entity, isLockedByOther, tryLock, syncState],
    );

    if (!entity) return null;

    return (
        <div
            ref={penRef}
            style={{
                position: 'fixed',
                left: penPositionRef.current.x,
                top: penPositionRef.current.y,
                cursor: isLockedByOther ? 'not-allowed' : isDraggingRef.current ? 'grabbing' : 'grab',
                zIndex: isDraggingRef.current ? 1000 : 100,
                opacity: isLockedByOther ? 0.5 : 1,
                transform: isDraggingRef.current ? 'scale(1.1) rotate(-15deg)' : 'rotate(0deg)',
                transition: isDraggingRef.current ? 'none' : 'transform 0.2s, opacity 0.2s',
                userSelect: 'none',
            }}
            onMouseDown={handlePenMouseDown}
        >
            <PenIcon color={entity.data.color} size={48} />
            {isDraggingRef.current && (
                <div
                    style={{
                        position: 'absolute',
                        top: -20,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                    }}
                >
                    描画中...
                </div>
            )}
            {isLockedByOther && (
                <div
                    style={{
                        position: 'absolute',
                        top: -20,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(255,0,0,0.8)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                    }}
                >
                    使用中
                </div>
            )}
        </div>
    );
};

// ============================================
// Factory
// ============================================

interface CreatePenWidgetProps {
    x?: number;
    y?: number;
    color?: string;
    strokeWidth?: number;
}

export const useCreatePenWidget = () => {
    const { createEntity } = useWorld();

    const create = useCallback(
        async (props: CreatePenWidgetProps = {}) => {
            const {
                x = 100,
                y = 100,
                color = '#000000',
                strokeWidth = 4,
            } = props;

            const transform: EntityTransform = {
                x,
                y,
                z: 0,
                w: 48,
                h: 48,
                rotation: 0,
            };

            const data: PenData = {
                color,
                strokeWidth,
                isHeld: false,
            };

            return createEntity<PenData>('pen', transform, data);
        },
        [createEntity],
    );

    return { createPenWidget: create };
};

// Re-export types
export type { PenData, PenStream, Stroke };
