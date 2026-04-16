/**
 * AvatarCursorSystem — ローカルカーソル表示を担当。
 * cursor.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import {
    initialized,
    LERP_SPEED,
    lerpViewportX,
    lerpViewportY,
    localCursorStyle,
    SNAP_THRESHOLD,
    setInitialized,
    setLerpViewportX,
    setLerpViewportY,
    setLocalAvatar,
    setLocalCursorStyle,
    setTargetViewportX,
    setTargetViewportY,
    targetViewportX,
    targetViewportY,
} from '../state';
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
            if (!initialized) {
                setLerpViewportX(d.viewportX);
                setLerpViewportY(d.viewportY);
                setInitialized(true);
            }
            setTargetViewportX(d.viewportX);
            setTargetViewportY(d.viewportY);
            if (d.cursorStyle && d.cursorStyle !== localCursorStyle) {
                setLocalCursorStyle(d.cursorStyle);
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === myUserId && user.avatar) {
                setLocalAvatar(user.avatar);
            }
        }
    }

    // viewport lerp
    if (initialized) {
        const dvx = targetViewportX - lerpViewportX;
        const dvy = targetViewportY - lerpViewportY;
        if (Math.abs(dvx) < SNAP_THRESHOLD && Math.abs(dvy) < SNAP_THRESHOLD) {
            setLerpViewportX(targetViewportX);
            setLerpViewportY(targetViewportY);
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            setLerpViewportX(lerpViewportX + dvx * f);
            setLerpViewportY(lerpViewportY + dvy * f);
        }
    }

    Ubi.ui.renderEntity(`user:${myUserId ?? 'unknown'}`, 'cursor', () => <AvatarCursor />);
};
