'use client';

import type { PluginGuestCommand } from '@ubichill/sdk';
import { usePluginWorker } from '@ubichill/sdk';
import { useEffect, useRef } from 'react';
import { penPluginCode } from './PenBehaviour.gen';

interface PenWorkerProps {
    /** ペンエンティティのID（将来の拡張用） */
    entityId: string;
    /** ペンの色 */
    color: string;
    /** ストローク幅 */
    strokeWidth: number;
    /** ペンを持っているかどうか */
    isLockedByMe: boolean;
    /** 描画中のストロークポイント */
    onDrawingUpdate: (points: number[][]) => void;
    /** ストローク完了時のコールバック */
    onStrokeComplete: (strokeData: { points: number[][]; color: string; size: number }) => void;
    /** ペン位置更新のコールバック */
    onPositionUpdate: (x: number, y: number) => void;
    /** エフェメラルデータのブロードキャスト */
    broadcast?: (data: unknown) => void;
}

/**
 * PenWorker - ペンの描画ロジックを Worker Sandbox 内で実行します
 *
 * ペンの移動追跡、ストローク描画、位置同期などの処理を
 * 全て Worker 内で行い、Host には描画データとペン位置のみを送信します。
 */
export const PenWorker: React.FC<PenWorkerProps> = ({
    entityId, // プラグインIDとしてSandboxに渡す
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

    const { sendEvent } = usePluginWorker({
        pluginCode: penPluginCode,
        pluginId: entityId,
        onCommand: (command: PluginGuestCommand) => {
            if (command.type === 'CUSTOM_MESSAGE') {
                const messageType = command.payload.type;
                const messageData = command.payload.data as { points?: number[][] };

                if (messageType === 'DRAWING_UPDATE' && messageData.points) {
                    onDrawingUpdateRef.current(messageData.points);

                    const now = Date.now();
                    if (now - lastBroadcastTimeRef.current > 30) {
                        if (broadcastRef.current) {
                            broadcastRef.current({
                                points: messageData.points,
                                color,
                                size: strokeWidth,
                            });
                        }
                        lastBroadcastTimeRef.current = now;
                    }
                } else if (messageType === 'STROKE_COMPLETE' && messageData.points) {
                    onStrokeCompleteRef.current({
                        points: messageData.points,
                        color,
                        size: strokeWidth,
                    });
                    if (broadcastRef.current) {
                        broadcastRef.current({
                            isComplete: true,
                            points: messageData.points,
                            color,
                            size: strokeWidth,
                        });
                    }
                } else if (messageType === 'DRAWING_CLEAR') {
                    onDrawingUpdateRef.current([]);
                    if (broadcastRef.current) {
                        broadcastRef.current({
                            isComplete: true,
                        });
                    }
                }
            }

            // カーソル位置更新
            if (command.type === 'SCENE_UPDATE_CURSOR') {
                onPositionUpdateRef.current(command.payload.x, command.payload.y);
            }
        },
    });

    // マウスイベントをWorkerに送信
    useEffect(() => {
        if (!isLockedByMe) return;

        // 座標系の正規化：
        // 画面の左上を原点(0,0)とした「仮想ワールド（絶対ピクセル）座標」として扱うため、
        // スクロール量を含めたページ上の絶対座標に変換して Behavior に送るようにします。
        // これによって、画面サイズが違っても「絶対的なピクセル位置」にペンが描画されます。
        const getAbsoluteCords = (e: MouseEvent) => {
            return {
                x: e.clientX + window.scrollX,
                y: e.clientY + window.scrollY,
            };
        };

        const handleMouseMove = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({
                type: 'EVT_CUSTOM',
                payload: {
                    eventType: 'MOUSE_MOVE',
                    data: { x, y, buttons: e.buttons },
                },
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({
                type: 'EVT_CUSTOM',
                payload: {
                    eventType: 'MOUSE_DOWN',
                    data: { x, y, button: e.button },
                },
            });
        };

        const handleMouseUp = (e: MouseEvent) => {
            const { x, y } = getAbsoluteCords(e);
            sendEvent({
                type: 'EVT_CUSTOM',
                payload: {
                    eventType: 'MOUSE_UP',
                    data: { x, y, button: e.button },
                },
            });
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

    return null; // このコンポーネントはUIを持たない
};
