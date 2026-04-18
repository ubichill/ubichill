/**
 * PenSyncSystem
 *
 * ストローク完成時（isDrawing=false かつ currentStroke が存在）:
 * 1. Ubi.canvas.commitStroke → 自分のストロークを即座にローカルコミット（ネットワーク往復を待たない）
 * 2. Ubi.network.broadcast → entity:ephemeral（揮発性・既存ユーザーへのリアルタイム同期）
 * 3. Ubi.world.createEntity  → entity:create（永続化・後から参加するユーザーが取得可能）
 *
 * ローカルコミット後にフィンガープリントを記録しておき、
 * entity:pen:stroke で同じストロークが戻ってきた際に PenCanvasSystem が二重描画をスキップする。
 */

import type { Entity, System } from '@ubichill/sdk';
import type { DrawStateData } from '../components';
import { DrawState } from '../components';
import { addCommittedFingerprint, strokeFingerprint } from '../penFingerprint';

const CANVAS_TARGET = 'drawing';

export const PenSyncSystem: System = (entities: Entity[]) => {
    const drawEntity = entities.find((e) => e.hasComponent(DrawState.name));
    if (!drawEntity) return;

    const state = drawEntity.getComponent<DrawStateData>(DrawState.name);
    if (!state || state.isDrawing || state.currentStroke.length <= 1) return;

    const strokeData = {
        points: state.currentStroke.slice(),
        color: state.color,
        size: state.strokeWidth,
    };
    state.currentStroke = [];

    // 自分のストロークを即座にコミット（ネットワーク往復なし）
    Ubi.canvas.commitStroke(CANVAS_TARGET, strokeData);
    addCommittedFingerprint(strokeFingerprint(strokeData));

    Ubi.network.broadcast('pen:stroke_complete', strokeData);

    Ubi.world
        .createEntity({
            type: 'pen:stroke',
            ownerId: null,
            lockedBy: null,
            transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
            data: strokeData,
        })
        .catch((err: unknown) => {
            Ubi.log(`[PenSync] 永続化失敗: ${String(err)}`, 'warn');
        });
};
