/**
 * PenWatchSystem (canvas worker 用)
 *
 * 全世界の pen:pen エンティティを watch し、自分のユーザーが保持中
 * (lockedBy === myUserId) のペンを 1 つだけ追跡する。
 * 色 / 太さ / pen Entity id を canvas state に反映する。
 *
 * 選択ロジック自体は pen:pen Worker にあるため、ここは「結果を読むだけ」。
 */

import type { ComponentInstance, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { draw } from '../canvas.worker';

interface PenPenData {
    color?: string;
    strokeWidth?: number;
}

export const PenWatchSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type !== 'entity:pen:pen') continue;

        const pen = event.payload as ComponentInstance<PenPenData>;
        const isHeldByMe = pen.lockedBy === Ubi.myUserId;

        if (isHeldByMe) {
            if (draw.local.heldPenId !== pen.id) {
                draw.local.isDrawing = false;
                draw.local.currentStroke = [];
            }
            draw.local.heldPenId = pen.id;
            draw.local.heldPenEntityId = pen.entityId ?? null;
            if (pen.data.color !== undefined) draw.local.color = pen.data.color;
            if (pen.data.strokeWidth !== undefined) draw.local.strokeWidth = pen.data.strokeWidth;
        } else if (pen.id === draw.local.heldPenId) {
            // 自分が保持していたペンが別ユーザーに取られた or 自分自身が解放した
            draw.local.heldPenId = null;
            draw.local.heldPenEntityId = null;
            draw.local.isDrawing = false;
            draw.local.currentStroke = [];
        }
    }
};
