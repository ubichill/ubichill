/**
 * Pen Input System
 *
 * Host からのマウスイベントを受け取り、Pen Entity の Transform と PenState を更新します。
 * 以下のイベントを処理：
 * - MOUSE_MOVE: カーソル位置を更新
 * - MOUSE_DOWN: 描画開始
 * - MOUSE_UP: 描画終了
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';
import { PenState, Transform } from '../components';
import type { PenStateData, TransformData } from '../components';

declare const Ubi: any;

export const PenInputSystem: System = (entities: Entity[], dt: number, events: WorkerEvent[]) => {
    // Pen Entity を全て取得（Transform と PenState を持つエンティティ）
    const penEntities = entities.filter((e) => e.hasComponent(Transform.name) && e.hasComponent(PenState.name));

    if (penEntities.length === 0) return;

    // イベント処理
    for (const event of events) {
        if (event.type === 'MOUSE_MOVE') {
            const { x, y, buttons } = event.payload as { x: number; y: number; buttons: number };

            for (const entity of penEntities) {
                const transform = entity.getComponent<TransformData>(Transform.name)!;
                const penState = entity.getComponent<PenStateData>(PenState.name)!;

                // ペン位置を更新（オフセット付き）
                const PEN_OFFSET_X = 0;
                const PEN_OFFSET_Y = -48;
                transform.x = x + PEN_OFFSET_X;
                transform.y = y + PEN_OFFSET_Y;
                penState.mouseButtons = buttons;
                if (penState.isDrawing && (buttons & 1)) {
                    penState.currentStroke.push([x, y, 1]);
                }
                Ubi.scene.updateCursorPosition(transform.x, transform.y);
            }
        } else if (event.type === 'MOUSE_DOWN') {
            const { x, y, button } = event.payload as { x: number; y: number; button: number };

            // 左クリックのみ処理
            if (button === 0) {
                for (const entity of penEntities) {
                    const penState = entity.getComponent<PenStateData>(PenState.name)!;
                    penState.isDrawing = true;
                    penState.currentStroke = [[x, y, 1]];
                    penState.mouseButtons = 1;
                }
            }
        } else if (event.type === 'MOUSE_UP') {
            const { button } = event.payload as { button: number };

            for (const entity of penEntities) {
                const penState = entity.getComponent<PenStateData>(PenState.name)!;
                if (penState.isDrawing) {
                    penState.isDrawing = false;
                }
                penState.mouseButtons = 0;
            }
        }
    }
};
