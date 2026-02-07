'use client';

import { useObjectInteraction, useSocket, useWorld, Z_INDEX } from '@ubichill/sdk';
import type { WorldEntity } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PEN_CONFIG } from './config';
import { usePenCanvas } from './context/PenCanvasContext';
import { PenIcon } from './PenIcon';
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
    const { releaseOthers } = useObjectInteraction(entity.id, 'pen', isLockedByMe, {
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
        if (remoteStream?.currentPoints && remoteStream.currentPoints.length > 0 && entityRef.current) {
            penCanvasRef.current.setRemoteDrawing(entity.id, {
                points: remoteStream.currentPoints,
                color: entityRef.current.data.color,
                size: entityRef.current.data.strokeWidth,
            });
        } else {
            penCanvasRef.current.setRemoteDrawing(entity.id, null);
        }
    }, [remoteStream?.currentPoints, entity.id]);

    // リモートからのペン位置更新
    useEffect(() => {
        if (!isDraggingRef.current) {
            penPositionRef.current = { x: entity.transform.x, y: entity.transform.y };
            setRenderTrigger((t) => t + 1);
        }
    }, [entity.transform.x, entity.transform.y]);

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

    // マウスイベントハンドラ（追従モード・描画モード用）
    useEffect(() => {
        if (!isLockedByMe) return;

        const handleMouseMove = (e: MouseEvent) => {
            const ent = entityRef.current;
            if (!ent) return;

            // マウス位置にペンを追従させる
            // オフセット調整: ペン先がカーソルに来るように
            const offsetX = 0;
            const offsetY = -48; // ペン先調整

            const newX = e.clientX + offsetX;
            const newY = e.clientY + offsetY;

            penPositionRef.current = { x: newX, y: newY };
            setRenderTrigger((t) => t + 1);

            // 描画モードの安全策: 左クリックが押されていなければ描画終了とみなす
            if (isDrawingRef.current && (e.buttons & 1) === 0) {
                handleMouseUp();
                return;
            }

            // 描画中ならストロークを追加
            if (isDrawingRef.current) {
                const point = [e.clientX, e.clientY, 1]; // 筆圧は1固定
                currentPointsRef.current = [...currentPointsRef.current, point];

                penCanvasRef.current.setCurrentDrawing({
                    points: currentPointsRef.current,
                    color: ent.data.color,
                    size: ent.data.strokeWidth,
                });
            }

            if (broadcast) {
                broadcast({
                    currentPoints: isDrawingRef.current ? currentPointsRef.current : [],
                    penPosition: { x: newX, y: newY },
                });
            }

            setRenderTrigger((t) => t + 1);
        };

        const handleMouseDown = (e: MouseEvent) => {
            // 左クリックのみ反応
            if (e.button !== 0) return;
            if (!entityRef.current) return;

            isDrawingRef.current = true;
            currentPointsRef.current = [[e.clientX, e.clientY, 1]];
        };

        const handleMouseUp = () => {
            const ent = entityRef.current;
            if (!ent) return;

            if (isDrawingRef.current && currentPointsRef.current.length > 1) {
                // Persistent Entityとして保存
                const strokeData = {
                    points: currentPointsRef.current,
                    color: ent.data.color,
                    size: ent.data.strokeWidth,
                };

                // 位置は (0,0) を基準にする（pointsが絶対座標のため）
                createEntityRef.current('stroke', { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 }, strokeData);
            }

            penCanvasRef.current.setCurrentDrawing(null);
            currentPointsRef.current = [];
            isDrawingRef.current = false;
        };

        // 定期的な位置同期（Reliable）を行うためのインターバル
        const syncInterval = setInterval(() => {
            const ent = entityRef.current;
            if (ent && (penPositionRef.current.x !== ent.transform.x || penPositionRef.current.y !== ent.transform.y)) {
                update({
                    transform: { ...ent.transform, x: penPositionRef.current.x, y: penPositionRef.current.y },
                });
            }
        }, 100);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            clearInterval(syncInterval);
        };
    }, [isLockedByMe, update, broadcast]);

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
                left: penPositionRef.current.x,
                top: penPositionRef.current.y,
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
    );
};
