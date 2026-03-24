/**
 * Pen Input System
 *
 * Host から EcsEventType.INPUT_* として届く入力イベントを受け取り、
 * Pen Entity の Transform と PenState を更新します。
 *
 * 入力は PluginHostManager の InputCollector が毎フレーム自動収集し、
 * EVT_LIFECYCLE_TICK の直前に EVT_INPUT として全 Worker へ配信されます。
 * プラグイン開発者は Frontend コードを書かずに入力を受け取れます。
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
import type { PenStateData, TransformData } from '../components';
import { PenState, Transform } from '../components';

const PEN_OFFSET_X = 0;
const PEN_OFFSET_Y = -48;

export const PenInputSystem: System = (entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const penEntities = entities.filter((e) => e.hasComponent(Transform.name) && e.hasComponent(PenState.name));
    if (penEntities.length === 0) return;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const { x, y, buttons } = event.payload as InputMouseMoveData;
            for (const entity of penEntities) {
                const transform = entity.getComponent<TransformData>(Transform.name);
                const penState = entity.getComponent<PenStateData>(PenState.name);
                if (!transform || !penState) continue;

                transform.x = x + PEN_OFFSET_X;
                transform.y = y + PEN_OFFSET_Y;
                penState.mouseButtons = buttons;

                if (penState.isDrawing && buttons & 1) {
                    penState.currentStroke.push([x, y, 1]);
                }

                Ubi.network.sendToHost<{ 'cursor:position': { x: number; y: number } }>('cursor:position', {
                    x: transform.x,
                    y: transform.y,
                });
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_DOWN) {
            const { x, y, button } = event.payload as InputMouseDownData;
            if (button === 0) {
                for (const entity of penEntities) {
                    const penState = entity.getComponent<PenStateData>(PenState.name);
                    if (!penState) continue;
                    penState.isDrawing = true;
                    penState.currentStroke = [[x, y, 1]];
                    penState.mouseButtons = 1;
                }
            }
        } else if (event.type === EcsEventType.INPUT_MOUSE_UP) {
            const { button } = event.payload as InputMouseUpData;
            if (button === 0) {
                for (const entity of penEntities) {
                    const penState = entity.getComponent<PenStateData>(PenState.name);
                    if (!penState) continue;
                    penState.isDrawing = false;
                    penState.mouseButtons = 0;
                }
            }
        }
    }
};
