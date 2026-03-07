'use client';

import type { WorldEntity } from '@ubichill/sdk';
import { useObjectInteraction, useSocket, useWorld, Z_INDEX } from '@ubichill/sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PEN_CONFIG } from './config';
import { usePenCanvas } from './context/PenCanvasContext';
import { PenIcon } from './PenIcon';
import { PenWorker } from './PenWorker';
import type { PenData, PenStream } from './types';

// ============================================
// Pen Widget Component
// ============================================

interface PenWidgetProps {
    entity: WorldEntity<PenData>;
    isLocked: boolean;
    update: (patch: Partial<WorldEntity<PenData>>) => void;
    ephemeral?: unknown;
    broadcast?: (data: unknown) => void;
}

export const PenWidget: React.FC<PenWidgetProps> = ({ entity, isLocked, update, ephemeral, broadcast }) => {
    const { currentUser, users } = useSocket();
    const penCanvas = usePenCanvas();
    const penCanvasRef = useRef(penCanvas);
    penCanvasRef.current = penCanvas;

    const { createEntity } = useWorld();
    const createEntityRef = useRef(createEntity);
    createEntityRef.current = createEntity;

    const isLockedByMe = entity.lockedBy === currentUser?.id;
    const isLockedByOther = isLocked && !isLockedByMe;

    // ✨ 新しいフックで「振る舞い」を定義
    const { releaseOthers } = useObjectInteraction(entity.id, isLockedByMe, {
        hideCursor: true, // 持っている間カーソルを隠す
        singleHold: true, // 他のペンを持っていたら離す
        onAutoRelease: (ent: WorldEntity) => {
            if (ent.type !== 'pen:pen') return {};

            const pData = ent.data as unknown as PenData;

            let offsetX: number = PEN_CONFIG.OFFSETS.BLACK;
            if (pData.color === PEN_CONFIG.COLORS.RED) offsetX = PEN_CONFIG.OFFSETS.RED;
            else if (pData.color === PEN_CONFIG.COLORS.BLUE) offsetX = PEN_CONFIG.OFFSETS.BLUE;
            else if (pData.color === PEN_CONFIG.COLORS.GREEN) offsetX = PEN_CONFIG.OFFSETS.GREEN;

            const targetX = PEN_CONFIG.TRAY_X_BASE + offsetX;
            const targetY = PEN_CONFIG.DEFAULT_Y;

            return {
                transform: {
                    ...ent.transform,
                    x: targetX,
                    y: targetY,
                    rotation: 0,
                },
            };
        },
    });

    const penRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const isDrawingRef = useRef(false);
    const currentPointsRef = useRef<number[][]>([]);
    const penPositionRef = useRef({ x: entity.transform.x, y: entity.transform.y });
    const entityRef = useRef(entity);
    entityRef.current = entity;
    const [, setRenderTrigger] = useState(0);

    // リモートユーザーの描画を更新
    const remoteStream = ephemeral as PenStream | null;
    useEffect(() => {
        // もし自分が持っているペンなら自分のローカルWorkerで描画の同期（Broadcast）を行っているので、
        // ここでの ephemeral な受け取りは無視する、あるいは統合する
        if (isLockedByMe) return;

        if (remoteStream?.currentPoints && remoteStream.currentPoints.length > 0 && entityRef.current) {
            penCanvasRef.current.setRemoteDrawing(entity.id, {
                points: remoteStream.currentPoints,
                color: entityRef.current.data.color,
                size: entityRef.current.data.strokeWidth,
            });
        } else {
            penCanvasRef.current.setRemoteDrawing(entity.id, null);
        }
    }, [remoteStream?.currentPoints, entity.id, isLockedByMe]);

    // リモートからのペン位置更新 (isLockedByMe でない時の追従をスムーズにするため)
    useEffect(() => {
        if (!isLockedByMe && !isDraggingRef.current) {
            // 他人が持っている時は entity.transform が Reliable/Ephemeral で降ってくるので追従
            penPositionRef.current = { x: entity.transform.x, y: entity.transform.y };
            setRenderTrigger((t) => t + 1);
        }
    }, [entity.transform.x, entity.transform.y, isLockedByMe]);

    // ペンを持っている間はテキスト選択を無効化
    useEffect(() => {
        if (isLockedByMe) {
            document.body.style.userSelect = 'none';
            document.body.style.webkitUserSelect = 'none'; // Safari
        } else {
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
        }
        return () => {
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
        };
    }, [isLockedByMe]);

    // 定期的な位置同期（Reliable）
    useEffect(() => {
        if (!isLockedByMe) return;

        const syncInterval = setInterval(() => {
            const ent = entityRef.current;
            if (ent && (penPositionRef.current.x !== ent.transform.x || penPositionRef.current.y !== ent.transform.y)) {
                update({
                    transform: { ...ent.transform, x: penPositionRef.current.x, y: penPositionRef.current.y },
                });
            }
        }, 100);

        return () => {
            clearInterval(syncInterval);
        };
    }, [isLockedByMe, update]);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            // 他人がロックしている場合は無視
            if (isLockedByOther) return;

            if (!entity) return;

            // 自分がロックしていない（ロックされていない）場合はロックを取得
            if (!isLockedByMe && !entity.lockedBy) {
                // 排他制御: 他のものを離す
                releaseOthers();
                e.stopPropagation(); // キャンバスへの伝播を防ぐ

                // updateを使ってロック
                if (currentUser) {
                    update({ lockedBy: currentUser.id });
                }
            }
        },
        [isLockedByOther, isLockedByMe, entity, update, releaseOthers, currentUser],
    );

    if (!entity) return null;

    // ユーザー名を取得
    const ownerName = entity.lockedBy ? users.get(entity.lockedBy)?.name : 'Unknown';

    return (
        <>
            {/* Worker-based pen drawing logic */}
            {isLockedByMe && (
                <PenWorker
                    entityId={entity.id}
                    color={entity.data.color}
                    strokeWidth={entity.data.strokeWidth}
                    isLockedByMe={isLockedByMe}
                    onDrawingUpdate={(points) => {
                        currentPointsRef.current = points;
                        penCanvasRef.current.setCurrentDrawing({
                            points,
                            color: entity.data.color,
                            size: entity.data.strokeWidth,
                        });
                    }}
                    onStrokeComplete={(strokeData) => {
                        // Persistent Entityとして保存
                        createEntityRef.current(
                            'stroke',
                            { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
                            strokeData,
                        );
                        penCanvasRef.current.setCurrentDrawing(null);
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
                    transform: isDrawingRef.current ? 'scale(1.1) rotate(-15deg)' : 'rotate(0deg)',
                    transition: isDrawingRef.current ? 'none' : 'transform 0.1s, opacity 0.2s',
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
