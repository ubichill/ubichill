/**
 * Pen Sync System
 *
 * Pen Entity の状態更新を Host へ同期します。
 * PenState の変更を検出して、適切なメッセージを Host へ送信します。
 *
 * 送信メッセージ：
 * - DRAWING_UPDATE: 描画中のストロークが更新された（リアルタイム）
 * - STROKE_COMPLETE: ストロークが完成した（永続化される）
 * - DRAWING_CLEAR: 描画がキャンセルされた（UI をクリア）
 */

import type { Entity, System } from '@ubichill/sdk';
import { PenState, SyncState } from '../components';
import type { PenStateData, SyncStateData } from '../components';
import type { PenWorkerMessage } from '../types';

declare const Ubi: any;

export const PenSyncSystem: System = (entities: Entity[], dt: number) => {
    const penEntities = entities.filter(
        (e) => e.hasComponent(PenState.name) && e.hasComponent(SyncState.name),
    );

    for (const entity of penEntities) {
        const penState = entity.getComponent<PenStateData>(PenState.name)!;
        const syncState = entity.getComponent<SyncStateData>(SyncState.name)!;

        // 描画中のストロークを送信（リアルタイム）
        if (penState.isDrawing && penState.currentStroke.length > 0) {
            const msg: PenWorkerMessage = {
                type: 'DRAWING_UPDATE',
                payload: {
                    points: penState.currentStroke,
                },
            };

            // Host へ通知
            const now = Date.now();
            if (now - syncState.lastSyncTime > 30) {
                // 30ms 以上経過していれば送信
                Ubi.messaging.send(msg.type, msg.payload);
                syncState.lastSyncTime = now;
            }
        }

        // ストローク完成時の処理
        if (!penState.isDrawing && penState.currentStroke.length > 1) {
            const msg: PenWorkerMessage = {
                type: 'STROKE_COMPLETE',
                payload: {
                    points: penState.currentStroke,
                },
            };

            Ubi.messaging.send(msg.type, msg.payload);

            // ストロークをクリア
            penState.currentStroke = [];

            // 描画終了を通知
            const clearMsg: PenWorkerMessage = {
                type: 'DRAWING_CLEAR',
                payload: {},
            };
            Ubi.messaging.send(clearMsg.type, clearMsg.payload);
        }
    }
};
