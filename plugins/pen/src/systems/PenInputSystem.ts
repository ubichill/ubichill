/**
 * PenInputSystem
 *
 * マウス入力イベントを受け取り、draw.local のストローク・カーソル座標を更新する。
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
import { draw } from '../canvas.worker';

export const PenInputSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    if (draw.local.heldPenId === null) return;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const { x, y, buttons } = event.payload as InputMouseMoveData;
            draw.local.cursorX = x;
            draw.local.cursorY = y;
            if (draw.local.isDrawing && buttons & 1) {
                draw.local.currentStroke.push([x, y, 1]);
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_DOWN) {
            const { x, y, button } = event.payload as InputMouseDownData;
            if (button === 0) {
                draw.local.isDrawing = true;
                draw.local.currentStroke = [[x, y, 1]];
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_UP) {
            const { button } = event.payload as InputMouseUpData;
            if (button === 0) {
                draw.local.isDrawing = false;
            }
        }
    }
};
