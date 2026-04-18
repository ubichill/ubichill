/**
 * PenSyncSystem
 *
 * ストローク完成時:
 * 1. Ubi.canvas.commitStroke → ローカル即時コミット
 * 2. Ubi.network.broadcast → 既存ユーザーへのリアルタイム同期
 * 3. Ubi.world.createEntity → 永続化
 */

import type { Entity, System } from '@ubichill/sdk';
import { draw } from '../canvas.worker';
import { addCommittedFingerprint, strokeFingerprint } from '../penFingerprint';

const CANVAS_TARGET = 'drawing';

export const PenSyncSystem: System = (_entities: Entity[]) => {
    if (draw.local.isDrawing || draw.local.currentStroke.length <= 1) return;

    const strokeData = {
        points: draw.local.currentStroke.slice(),
        color: draw.local.color,
        size: draw.local.strokeWidth,
    };
    draw.local.currentStroke = [];

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
