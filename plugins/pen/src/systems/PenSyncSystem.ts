/**
 * PenSyncSystem
 *
 * 完成ストロークを 3 経路で配信する:
 * 1. Ubi.canvas.commitStroke         — 自分の canvas に即時描画
 * 2. Ubi.network.broadcast           — 他ユーザーへ揮発性同期
 * 3. Ubi.world.createEntity('pen:stroke', parent=heldPen) — DB 永続化
 *
 * pen:stroke は描いたペン Entity の子として生成される。
 * 「このストロークはどのペンが描いた」を Entity 階層で表現する。
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

    const parentEntityId = draw.local.heldPenEntityId ?? undefined;
    const strokeEntityId = parentEntityId ? `stroke-${crypto.randomUUID()}` : undefined;

    Ubi.world
        .createEntity({
            type: 'pen:stroke',
            entityId: strokeEntityId,
            parentEntityId,
            ownerId: null,
            lockedBy: null,
            transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
            data: strokeData,
        })
        .catch((err: unknown) => {
            Ubi.log(`[PenSync] 永続化失敗: ${String(err)}`, 'warn');
        });
};
