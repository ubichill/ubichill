'use client';

import type { EntityTransform, WorldEntity } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useEntity, useWorld } from '../hooks/useEntity';
import { useSocket } from '../hooks/useSocket';
import { useObjectInteraction } from '../hooks/useObjectInteraction';
import { useGlobalCanvas, type Stroke, type DrawingData } from '../contexts/GlobalCanvasContext';

// ============================================
// Types
// ============================================

/** Pen Widget のデータ構造（Reliable） */
export interface PenData {
    color: string;
    strokeWidth: number;
    isHeld: boolean;
}

/** Pen Widget のストリームデータ（Volatile） */
export interface PenStream {
    currentPoints?: number[][];
    penPosition?: { x: number; y: number };
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
    const { currentUser, socket } = useSocket();
    // エラーハンドリングのための try-catch はフックには使えないので、ログで追う
    const globalCanvas = useGlobalCanvas();

    const globalCanvasRef = useRef(globalCanvas);
    globalCanvasRef.current = globalCanvas;

    // useEntity は今や WorldContext を使用する
    const { createEntity } = useWorld();
    const createEntityRef = useRef(createEntity);
    createEntityRef.current = createEntity;
    const { entity, ephemeral, syncState, syncStream, tryLock, unlock, isLockedByMe, isLockedByOther } =
        useEntity<PenData>(entityId, { initialEntity });

    // ✨ 新しいフックで「振る舞い」を定義
    const { releaseOthers } = useObjectInteraction(entityId, 'pen', isLockedByMe, {
        hideCursor: true,  // 持っている間カーソルを隠す
        singleHold: true,  // 他のペンを持っていたら離す
    });

    useEffect(() => {
        // console.log(`[PenWidget ${entityId}] Mounted/Updated. Entity:`, entity ? 'Found' : 'Null', 'LockedByMe:', isLockedByMe);
    }, [entityId, entity, isLockedByMe]);

    const penRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const isDrawingRef = useRef(false);
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

    // マウスイベントハンドラ（追従モード・描画モード用）
    useEffect(() => {
        console.log(`[PenWidget ${entityId}] LockedByMe changed to:`, isLockedByMe, 'LockedBy:', entity?.lockedBy, 'Me:', currentUser?.id);
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

                globalCanvasRef.current.setCurrentDrawing({
                    points: currentPointsRef.current,
                    color: ent.data.color,
                    size: ent.data.strokeWidth,
                });
            }

            syncStream({
                currentPoints: isDrawingRef.current ? currentPointsRef.current : [],
                penPosition: { x: newX, y: newY },
            });

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
                } as any; // 型アサーションで回避

                // 位置は (0,0) を基準にする（pointsが絶対座標のため）
                createEntityRef.current('stroke', { x: 0, y: 0, z: 0, w: 0, h: 0, rotation: 0 }, strokeData);
            }

            globalCanvasRef.current.setCurrentDrawing(null);
            currentPointsRef.current = [];
            isDrawingRef.current = false;
        };

        // 定期的な位置同期（Reliable）を行うためのインターバル
        const syncInterval = setInterval(() => {
            const ent = entityRef.current;
            if (ent && (penPositionRef.current.x !== ent.transform.x || penPositionRef.current.y !== ent.transform.y)) {
                syncState({
                    transform: { ...ent.transform, x: penPositionRef.current.x, y: penPositionRef.current.y }
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
    }, [isLockedByMe, syncState, syncStream, createEntityRef]);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            console.log(`[PenWidget ${entityId}] Clicked. LockedByMe: ${isLockedByMe}, LockedBy: ${entity?.lockedBy}`);
            // 他人がロックしている場合は無視
            if (isLockedByOther) return;

            if (!entity) return;

            // 自分がロックしていない（ロックされていない）場合はロックを取得
            if (!isLockedByMe && !entity.lockedBy) {
                // 排他制御: 他のものを離す
                releaseOthers();

                console.log(`[PenWidget ${entityId}] Trying to lock...`);
                tryLock();
                e.stopPropagation(); // キャンバスへの伝播を防ぐ
            }
        },
        [isLockedByOther, isLockedByMe, entity, tryLock, releaseOthers],
    );

    if (!entity) return null;

    // ユーザー名を取得
    const { users } = useSocket();
    const ownerName = entity.lockedBy ? users.get(entity.lockedBy)?.name : 'Unknown';

    return (
        <div
            ref={penRef}
            onClick={handleClick}
            style={{
                position: 'fixed',
                left: penPositionRef.current.x,
                top: penPositionRef.current.y,
                pointerEvents: isLockedByMe ? 'none' : 'auto', // 自分が持っているときはイベント透過（描画のため）、持っていないときはクリック可能に
                zIndex: isLockedByMe ? 1000 : 100,
                opacity: isLockedByOther ? 0.7 : 1, // 少し不透明度を上げる
                cursor: !isLockedByMe && !isLockedByOther ? 'pointer' : 'default',
                transform: isDrawingRef.current ? 'scale(1.1) rotate(-15deg)' : 'rotate(0deg)',
                transition: isDrawingRef.current ? 'none' : 'transform 0.1s, opacity 0.2s',
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
                        borderRadius: 12, // 丸くする
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
