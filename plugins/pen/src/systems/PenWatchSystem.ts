/**
 * PenWatchSystem
 *
 * watchEntityTypes: ['pen:pen'] により、ワールドの pen:pen エンティティが
 * 変更されると 'entity:pen:pen' イベントとして届く。
 *
 * 全ての pen:pen エンティティを監視し、isHeld=true のものを特定して
 * draw.local にスタイル（color / strokeWidth）と heldPenId を反映する。
 * 保持ペンが変わった・リリースされた場合はストロークをリセットする。
 */

import type { Entity, System, WorkerEvent, WorldEntity } from '@ubichill/sdk';
import { draw } from '../canvas.worker';

interface PenPenData {
    color?: string;
    strokeWidth?: number;
}

export const PenWatchSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type !== 'entity:pen:pen') continue;

        const worldEntity = event.payload as WorldEntity<PenPenData>;
        const data = worldEntity.data;
        // lockedBy が自分のユーザーID と一致する場合のみ「持っている」
        const isHeldByMe = worldEntity.lockedBy === Ubi.myUserId;

        if (isHeldByMe) {
            // 別のペンに切り替わった場合はストロークをリセット
            if (draw.local.heldPenId !== worldEntity.id) {
                draw.local.isDrawing = false;
                draw.local.currentStroke = [];
            }
            draw.local.heldPenId = worldEntity.id;
            if (data.color !== undefined) draw.local.color = data.color;
            if (data.strokeWidth !== undefined) draw.local.strokeWidth = data.strokeWidth;
        } else if (worldEntity.id === draw.local.heldPenId) {
            // 自分が保持していたペンが別ユーザーに取られた or 返却された
            draw.local.heldPenId = null;
            draw.local.isDrawing = false;
            draw.local.currentStroke = [];
        }
    }
};
