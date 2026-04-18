/**
 * PenInputSystem
 *
 * Host から EcsEventType.INPUT_* として届く入力イベントを受け取り、
 * DrawState のストローク・カーソル座標を更新する。
 *
 * heldPenId が null（ペン未選択）の場合は入力を無視する。
 */

import type {
    Entity,
    InputMouseDownData,
    InputMouseMoveData,
    InputMouseUpData,
    System,
    WorkerEvent,
} from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import type { DrawStateData } from '../components';
import { DrawState } from '../components';

export const PenInputSystem: System = (entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const drawEntity = entities.find((e) => e.hasComponent(DrawState.name));
    if (!drawEntity) return;
    const state = drawEntity.getComponent<DrawStateData>(DrawState.name);
    if (!state || state.heldPenId === null) return;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const { x, y, buttons } = event.payload as InputMouseMoveData;
            state.cursorX = x;
            state.cursorY = y;
            if (state.isDrawing && buttons & 1) {
                state.currentStroke.push([x, y, 1]);
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_DOWN) {
            const { x, y, button } = event.payload as InputMouseDownData;
            if (button === 0) {
                state.isDrawing = true;
                state.currentStroke = [[x, y, 1]];
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_UP) {
            const { button } = event.payload as InputMouseUpData;
            if (button === 0) {
                state.isDrawing = false;
            }
        }
    }
};
