/**
 * PenWatchSystem
 *
 * watchEntityTypes: ['pen:pen'] により、ワールドの pen:pen エンティティが
 * 変更されると 'entity:pen:pen' イベントとして届く。
 *
 * 全ての pen:pen エンティティを監視し、isHeld=true のものを特定して
 * ローカル DrawState にスタイル（color / strokeWidth）と heldPenId を反映する。
 * 保持ペンが変わった・リリースされた場合はストロークをリセットする。
 */

import type { Entity, System, WorkerEvent, WorldEntity } from '@ubichill/sdk';
import type { DrawStateData } from '../components';
import { DrawState } from '../components';

interface PenPenData {
    color?: string;
    strokeWidth?: number;
}

export const PenWatchSystem: System = (entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const drawEntity = entities.find((e) => e.hasComponent(DrawState.name));
    if (!drawEntity) return;

    for (const event of events) {
        if (event.type !== 'entity:pen:pen') continue;

        const worldEntity = event.payload as WorldEntity<PenPenData>;
        const state = drawEntity.getComponent<DrawStateData>(DrawState.name);
        if (!state) continue;

        const data = worldEntity.data;
        // lockedBy が自分のユーザーID と一致する場合のみ「持っている」
        const isHeldByMe = worldEntity.lockedBy === Ubi.myUserId;

        if (isHeldByMe) {
            // 別のペンに切り替わった場合はストロークをリセット
            if (state.heldPenId !== worldEntity.id) {
                state.isDrawing = false;
                state.currentStroke = [];
            }
            state.heldPenId = worldEntity.id;
            if (data.color !== undefined) state.color = data.color;
            if (data.strokeWidth !== undefined) state.strokeWidth = data.strokeWidth;
        } else if (worldEntity.id === state.heldPenId) {
            // 自分が保持していたペンが別ユーザーに取られた or 返却された
            state.heldPenId = null;
            state.isDrawing = false;
            state.currentStroke = [];
        }
    }
};
