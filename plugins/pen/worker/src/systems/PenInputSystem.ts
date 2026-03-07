/**
 * Pen Input System
 *
 * Host からの EVT_CUSTOM イベント（MOUSE_MOVE / MOUSE_DOWN / MOUSE_UP）を
 * 受け取り、Pen Entity の Transform と PenState を更新します。
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';
import type { PenStateData, TransformData } from '../components';
import { PenState, Transform } from '../components';
import type { PenHostMessage } from '../types';

// WorkerEvent のペイロードを PenHostMessage から型安全に取り出すヘルパー。
// event.type の一致を確認した後にペイロードを正しい型で扱える。
type EventPayload<T extends PenHostMessage['type']> = Extract<PenHostMessage, { type: T }>['payload'];

function isEvent<T extends PenHostMessage['type']>(
    event: WorkerEvent,
    type: T,
): event is { type: T; payload: EventPayload<T>; timestamp: number } {
    return event.type === type;
}

const PEN_OFFSET_X = 0;
const PEN_OFFSET_Y = -48;

export const PenInputSystem: System = (entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const penEntities = entities.filter((e) => e.hasComponent(Transform.name) && e.hasComponent(PenState.name));
    if (penEntities.length === 0) return;

    for (const event of events) {
        if (isEvent(event, 'MOUSE_MOVE')) {
            const { x, y, buttons } = event.payload;
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

                Ubi.scene.updateCursorPosition(transform.x, transform.y);
            }
        } else if (isEvent(event, 'MOUSE_DOWN')) {
            const { x, y, button } = event.payload;
            if (button === 0) {
                for (const entity of penEntities) {
                    const penState = entity.getComponent<PenStateData>(PenState.name);
                    if (!penState) continue;
                    penState.isDrawing = true;
                    penState.currentStroke = [[x, y, 1]];
                    penState.mouseButtons = 1;
                }
            }
        } else if (isEvent(event, 'MOUSE_UP')) {
            const { button } = event.payload;
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
