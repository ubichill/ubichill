/**
 * Avatar Plugin - Worker Entry Point (ECS-based)
 *
 * マウス入力は InputCollector が毎フレーム自動配信するため、
 * Frontend コードを書かずにカーソル位置を受け取れます。
 *
 * ECS 設計:
 *   Entity:     avatar-cursor
 *   Components: Position（補間後の位置）
 *               Target（最新のマウス位置）
 *               AvatarState（初期化フラグ・ロックフラグ）
 *   System:     AvatarCursorSystem
 *               INPUT_MOUSE_MOVE イベントで Target を更新し、
 *               毎フレーム Position を lerp して Ubi.network.sendToHost() で Host へ通知。
 *               'avatar:lock' イベントで入力受付を一時停止できる（busy ステータス等）。
 */

import type { Entity, InputMouseMoveData, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';

type PositionData = { x: number; y: number };
type AvatarStateData = { initialized: boolean; locked: boolean; lastSentX: number; lastSentY: number };

/** deltaTime に乗算する補間係数（大きいほど追従が速い） */
const LERP_SPEED = 0.015;
/** この距離以下はスナップ（微細な振動を防止） */
const SNAP_THRESHOLD = 0.1;

const AvatarCursorSystem: System = (entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const entity = entities.find(
        (e) => e.hasComponent('AvatarState') && e.hasComponent('Position') && e.hasComponent('Target'),
    );
    if (!entity) return;

    const state = entity.getComponent<AvatarStateData>('AvatarState');
    const pos = entity.getComponent<PositionData>('Position');
    const target = entity.getComponent<PositionData>('Target');
    if (!state || !pos || !target) return;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE && !state.locked) {
            const { x, y } = event.payload as InputMouseMoveData;
            target.x = x;
            target.y = y;
            // 初回マウス移動時はスナップ（lerp せずに即時追従）
            if (!state.initialized) {
                pos.x = x;
                pos.y = y;
                state.initialized = true;
            }
        } else if (event.type === 'avatar:lock') {
            const { locked } = event.payload as { locked: boolean };
            state.locked = locked;
        }
    }

    if (!state.initialized) return;

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;

    if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
        pos.x = target.x;
        pos.y = target.y;
    } else {
        const lerpFactor = Math.min(1, deltaTime * LERP_SPEED);
        pos.x += dx * lerpFactor;
        pos.y += dy * lerpFactor;
    }

    if (pos.x !== state.lastSentX || pos.y !== state.lastSentY) {
        state.lastSentX = pos.x;
        state.lastSentY = pos.y;
        Ubi.network.sendToHost('cursor:position', { x: pos.x, y: pos.y });
    }
};

const avatarEntity = Ubi.local.createEntity('avatar-cursor');
avatarEntity.setComponent('Position', { x: 0, y: 0 });
avatarEntity.setComponent('Target', { x: 0, y: 0 });
avatarEntity.setComponent('AvatarState', { initialized: false, locked: false, lastSentX: 0, lastSentY: 0 });

Ubi.registerSystem(AvatarCursorSystem);

console.log('[Avatar Worker] Initialized. ECS cursor interpolation active.');
