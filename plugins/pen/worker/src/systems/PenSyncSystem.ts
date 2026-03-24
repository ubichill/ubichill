/**
 * Pen Sync System
 *
 * Pen Entity の状態変化を Host へ同期します。
 *
 * 送信メッセージ：
 * - DRAWING_UPDATE : 描画中のプレビュー更新（30ms スロットリング）
 * - STROKE_COMPLETE: ストローク完成。Host 側でプレビュークリアも兼ねる。
 *
 * DRAWING_CLEAR は明示的な「全消し」操作（将来の消しゴム機能）のために
 * プロトコル上は残すが、ここでは送信しない。
 */

import type { Entity, System } from '@ubichill/sdk';
import type { PenStateData, SyncStateData } from '../components';
import { PenState, SyncState } from '../components';
import type { PenPayloads } from '../types';

const SYNC_INTERVAL_MS = 30;

export const PenSyncSystem: System = (entities: Entity[], _dt: number) => {
    const penEntities = entities.filter((e) => e.hasComponent(PenState.name) && e.hasComponent(SyncState.name));

    for (const entity of penEntities) {
        const penState = entity.getComponent<PenStateData>(PenState.name);
        const syncState = entity.getComponent<SyncStateData>(SyncState.name);
        if (!penState || !syncState) continue;

        if (penState.isDrawing && penState.currentStroke.length > 0) {
            // プレビュー更新（スロットリングあり）
            const now = Date.now();
            if (now - syncState.lastSyncTime >= SYNC_INTERVAL_MS) {
                Ubi.network.sendToHost<PenPayloads>('DRAWING_UPDATE', { points: penState.currentStroke });
                syncState.lastSyncTime = now;
            }
            continue;
        }

        if (!penState.isDrawing && penState.currentStroke.length > 1) {
            // ストローク完成: 先にクリアしてから送信（2重送信防止）
            const points = penState.currentStroke;
            penState.currentStroke = [];
            Ubi.network.sendToHost<PenPayloads>('STROKE_COMPLETE', { points });
        }
    }
};
