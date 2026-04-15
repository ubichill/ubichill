/**
 * AvatarCursorSystem — ローカルカーソル・リモートカーソルを担当。
 *
 * avatar:cursor エンティティの transform.z が CSS zIndex として使われる。
 * cursor.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import {
    initialized,
    LERP_SPEED,
    lastPositionSentAt,
    lastSentCursorState,
    lastSentX,
    lastSentY,
    lerpX,
    lerpY,
    localCursorStyle,
    POSITION_THROTTLE_MS,
    remoteUsers,
    SNAP_THRESHOLD,
    scrollX,
    scrollY,
    setInitialized,
    setLastPositionSentAt,
    setLastSentCursorState,
    setLastSentX,
    setLastSentY,
    setLerpX,
    setLerpY,
    setLocalAvatar,
    setLocalCursorStyle,
    setLocalStatus,
    setScrollX,
    setScrollY,
    setTargetX,
    setTargetY,
    targetX,
    targetY,
} from '../state';
import type { UserStatus } from '../types';
import { LocalCursor } from '../ui/LocalCursor';
import { RemoteCursor } from '../ui/RemoteCursor';
import { cssToState } from './utils';

export const AvatarCursorSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as {
                x: number;
                y: number;
                viewportX: number;
                viewportY: number;
                buttons: number;
                cursorStyle?: string;
            };
            if (!initialized) {
                setLerpX(d.x);
                setLerpY(d.y);
                setInitialized(true);
            }
            setTargetX(d.x);
            setTargetY(d.y);
            if (d.cursorStyle && d.cursorStyle !== localCursorStyle) {
                setLocalCursorStyle(d.cursorStyle);
            }
        }

        if (event.type === EcsEventType.INPUT_SCROLL) {
            const d = event.payload as { x: number; y: number };
            setScrollX(d.x);
            setScrollY(d.y);
            for (const [userId, user] of remoteUsers) {
                const vx = user.position.x - d.x;
                const vy = user.position.y - d.y;
                Ubi.ui.render(
                    () => <RemoteCursor user={{ ...user, position: { x: vx, y: vy } }} />,
                    `cursor-${userId}`,
                );
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as {
                id: string;
                name: string;
                position?: { x: number; y: number };
                cursorState?: string;
                status: UserStatus;
                avatar?: AppAvatarDef;
                penColor?: string | null;
            };
            if (user.id === myUserId) {
                if (user.status) setLocalStatus(user.status);
                if (user.avatar) setLocalAvatar(user.avatar);
            } else {
                remoteUsers.set(user.id, {
                    id: user.id,
                    name: user.name,
                    position: user.position ?? { x: 0, y: 0 },
                    cursorState: user.cursorState,
                    status: user.status,
                    avatar: user.avatar,
                    penColor: user.penColor,
                });
            }
        }

        if (event.type === EcsEventType.PLAYER_LEFT) {
            const userId = event.payload as string;
            remoteUsers.delete(userId);
            Ubi.ui.unmount(`cursor-${userId}`);
        }

        if (event.type === EcsEventType.PLAYER_CURSOR_MOVED) {
            const { userId, position } = event.payload as {
                userId: string;
                position: { x: number; y: number };
            };
            if (userId !== myUserId) {
                const user = remoteUsers.get(userId);
                if (user) {
                    remoteUsers.set(userId, { ...user, position });
                    const updatedUser = remoteUsers.get(userId);
                    if (updatedUser) {
                        const vx = position.x - scrollX;
                        const vy = position.y - scrollY;
                        Ubi.ui.render(
                            () => <RemoteCursor user={{ ...updatedUser, position: { x: vx, y: vy } }} />,
                            `cursor-${userId}`,
                        );
                    }
                }
            }
        }
    }

    // lerp
    if (initialized) {
        const dx = targetX - lerpX;
        const dy = targetY - lerpY;
        if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
            setLerpX(targetX);
            setLerpY(targetY);
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            setLerpX(lerpX + dx * f);
            setLerpY(lerpY + dy * f);
        }

        const now = Date.now();
        const cursorState = cssToState(localCursorStyle);
        if (
            now - lastPositionSentAt > POSITION_THROTTLE_MS &&
            (lerpX !== lastSentX || lerpY !== lastSentY || cursorState !== lastSentCursorState)
        ) {
            setLastPositionSentAt(now);
            setLastSentX(lerpX);
            setLastSentY(lerpY);
            setLastSentCursorState(cursorState);
            Ubi.network.sendToHost('position:update', { x: lerpX, y: lerpY, cursorState });
        }
    }

    Ubi.ui.render(() => <LocalCursor />, 'local-cursor');
};
