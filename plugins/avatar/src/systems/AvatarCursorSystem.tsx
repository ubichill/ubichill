/**
 * AvatarCursorSystem — ローカルカーソル表示を担当。
 * cursor.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import { cursor, LERP_SPEED, SNAP_THRESHOLD } from '../state';
import { AvatarCursor } from '../ui/AvatarCursor';

export const AvatarCursorSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as {
                viewportX: number;
                viewportY: number;
                cursorStyle?: string;
            };
            if (!cursor.initialized) {
                cursor.lerpViewportX = d.viewportX;
                cursor.lerpViewportY = d.viewportY;
                cursor.initialized = true;
            }
            cursor.targetViewportX = d.viewportX;
            cursor.targetViewportY = d.viewportY;
            if (d.cursorStyle && d.cursorStyle !== cursor.cursorStyle) {
                cursor.cursorStyle = d.cursorStyle;
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === myUserId && user.avatar) {
                cursor.avatar = user.avatar;
            }
        }
    }

    // viewport lerp
    if (cursor.initialized) {
        const dvx = cursor.targetViewportX - cursor.lerpViewportX;
        const dvy = cursor.targetViewportY - cursor.lerpViewportY;
        if (Math.abs(dvx) < SNAP_THRESHOLD && Math.abs(dvy) < SNAP_THRESHOLD) {
            cursor.lerpViewportX = cursor.targetViewportX;
            cursor.lerpViewportY = cursor.targetViewportY;
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            cursor.lerpViewportX += dvx * f;
            cursor.lerpViewportY += dvy * f;
        }
    }

    Ubi.ui.renderEntity(`user:${myUserId ?? 'unknown'}`, 'cursor', () => <AvatarCursor />);
};
