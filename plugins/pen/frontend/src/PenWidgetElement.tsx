'use client';

import type { WorldEntity } from '@ubichill/sdk';
import { usePluginWorker, Z_INDEX } from '@ubichill/sdk/react';
import type { UbiEntityContext } from '@ubichill/sdk/ui';
import { UbiWidget } from '@ubichill/sdk/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { DEFAULT_PENS, PEN_CONFIG } from './config';
import { penPluginCode } from './PenBehaviour.gen';
import { PenIcon } from './PenIcon';
import type { DrawingData, PenData, PenPayloads } from './types';

// ============================================
// PenWorker (usePluginWorker を使うため React コンポーネント)
// ============================================

interface PenWorkerProps {
    entityId: string;
    color: string;
    strokeWidth: number;
    onDrawingUpdate: (points: number[][]) => void;
    onStrokeComplete: (strokeData: { points: number[][]; color: string; size: number }) => void;
    onPositionUpdate: (x: number, y: number) => void;
    broadcast?: (data: unknown) => void;
}

const PenWorkerInner: React.FC<PenWorkerProps> = ({
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

// ============================================
// PenWidgetContent（Context から props で受け取る）
// ============================================

const PenWidgetContent: React.FC<{ ctx: UbiEntityContext<PenData> }> = ({ ctx }) => {
    const { entity, isLockedByMe, isLockedByOther, lockEntity, releaseOtherLocks, createEntity, users, broadcast } =
        ctx;

    const penRef = useRef<HTMLDivElement>(null);
    const penPositionRef = useRef({ x: entity.transform.x, y: entity.transform.y });
    const entityRef = useRef(entity);
    entityRef.current = entity;
    const [, setRenderTrigger] = useState(0);

    // 自分がロック中はカーソルを隠す
    useEffect(() => {
        if (isLockedByMe) {
            document.body.style.cursor = 'none';
        } else {
            document.body.style.cursor = 'default';
        }
        return () => {
            document.body.style.cursor = 'default';
        };
    }, [isLockedByMe]);

    // ペンを持っている間はテキスト選択を無効化
    useEffect(() => {
        if (isLockedByMe) {
            document.body.style.userSelect = 'none';
            (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
        } else {
            document.body.style.userSelect = '';
            (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
        }
        return () => {
            document.body.style.userSelect = '';
            (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
        };
    }, [isLockedByMe]);

    // リモートからのペン位置更新
    useEffect(() => {
        if (!isLockedByMe) {
            penPositionRef.current = { x: entity.transform.x, y: entity.transform.y };
            setRenderTrigger((t) => t + 1);
        }
    }, [entity.transform.x, entity.transform.y, isLockedByMe]);

    // 定期的な位置同期
    useEffect(() => {
        if (!isLockedByMe) return;
        const syncInterval = setInterval(() => {
            const ent = entityRef.current;
            if (ent && (penPositionRef.current.x !== ent.transform.x || penPositionRef.current.y !== ent.transform.y)) {
                ctx.patchEntity({
                    transform: { ...ent.transform, x: penPositionRef.current.x, y: penPositionRef.current.y },
                });
            }
        }, 100);
        return () => clearInterval(syncInterval);
    }, [isLockedByMe, ctx]);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            if (isLockedByOther) return;
            if (!isLockedByMe && !entity.lockedBy) {
                releaseOtherLocks({
                    onAutoRelease: (ent: WorldEntity) => {
                        if (ent.type !== 'pen:pen') return {};
                        const pData = ent.data as unknown as PenData;
                        const config = DEFAULT_PENS.find((c) => c.color === pData.color);
                        const offsetX = config ? config.x : PEN_CONFIG.OFFSETS.BLACK;
                        return {
                            transform: {
                                ...ent.transform,
                                x: PEN_CONFIG.TRAY_X_BASE + offsetX,
                                y: PEN_CONFIG.DEFAULT_Y,
                                rotation: 0,
                            },
                        };
                    },
                });
                e.stopPropagation();
                lockEntity();
            }
        },
        [isLockedByOther, isLockedByMe, entity.lockedBy, releaseOtherLocks, lockEntity],
    );

    const ownerName = entity.lockedBy ? users.get(entity.lockedBy)?.name : 'Unknown';

    // ペン描画イベントを PenCanvasElement に伝える
    const dispatchDrawingEvent = useCallback(
        (drawing: DrawingData | null) => {
            document.dispatchEvent(
                new CustomEvent('ubi:pen-drawing', {
                    detail: { entityId: entity.id, drawing },
                    bubbles: false,
                }),
            );
        },
        [entity.id],
    );

    return (
        <>
            {isLockedByMe && (
                <PenWorkerInner
                    entityId={entity.id}
                    color={entity.data.color}
                    strokeWidth={entity.data.strokeWidth}
                    onDrawingUpdate={(points) => {
                        dispatchDrawingEvent({ points, color: entity.data.color, size: entity.data.strokeWidth });
                    }}
                    onStrokeComplete={(strokeData) => {
                        createEntity('stroke', { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 }, strokeData);
                        dispatchDrawingEvent(null);
                    }}
                    onPositionUpdate={(x, y) => {
                        penPositionRef.current = { x, y };
                        setRenderTrigger((t) => t + 1);
                    }}
                    broadcast={broadcast}
                />
            )}

            <div
                ref={penRef}
                onClick={handleClick}
                style={{
                    width: 48,
                    height: 48,
                    cursor: !isLockedByMe && !isLockedByOther ? 'pointer' : 'default',
                    transition: 'transform 0.1s, opacity 0.2s',
                    opacity: isLockedByOther ? 0.7 : 1,
                    pointerEvents: isLockedByMe ? 'none' : 'auto',
                    zIndex: isLockedByMe ? Z_INDEX.HELD_ITEM : Z_INDEX.WORLD_ITEMS,
                    position: 'fixed',
                    left: penPositionRef.current.x - (typeof window !== 'undefined' ? window.scrollX : 0),
                    top: penPositionRef.current.y - (typeof window !== 'undefined' ? window.scrollY : 0),
                }}
            >
                <PenIcon color={entity.data.color} size={48} />
                {isLockedByOther && (
                    <div
                        style={{
                            position: 'absolute',
                            top: -24,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            backgroundColor: entity.data.color,
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            border: '1px solid white',
                        }}
                    >
                        {ownerName}
                    </div>
                )}
            </div>
        </>
    );
};

// ============================================
// Custom Element
// ============================================

export class PenWidgetElement extends UbiWidget<PenData> {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiEntityContext<PenData>) {
        this.#root?.render(<PenWidgetContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
