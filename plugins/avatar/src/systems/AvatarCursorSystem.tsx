/**
 * AvatarCursorSystem — ローカルカーソル表示を担当。
 * cursor.worker.tsx にのみ登録される。
 */

import type { AnimFrame } from '../state';
import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import { cursor, LERP_SPEED, SNAP_THRESHOLD } from '../state';
import { AvatarCursor } from '../ui/AvatarCursor';
import { cssToState } from './utils';

export const AvatarCursorSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as {
                viewportX: number;
                viewportY: number;
            };
            if (!cursor.initialized) {
                cursor.lerpViewportX = d.viewportX;
                cursor.lerpViewportY = d.viewportY;
                cursor.initialized = true;
            }
            cursor.targetViewportX = d.viewportX;
            cursor.targetViewportY = d.viewportY;
        }

        if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
            const d = event.payload as { style: string };
            if (d.style !== cursor.cursorStyle) {
                cursor.cursorStyle = d.style;
                cursor.animFrame = 0;
                cursor.animElapsed = 0;
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === myUserId && user.avatar) {
                cursor.avatar = user.avatar;
                cursor.stateFrames = {};
                cursor.animFrame = 0;
                cursor.animElapsed = 0;
                // sourceUrl を持つ状態のフレームをホストへ要求する
                const sourceUrls = Object.entries(user.avatar.states)
                    .filter(([, def]) => def?.sourceUrl)
                    .map(([state, def]) => ({ state, sourceUrl: def!.sourceUrl! }));
                if (sourceUrls.length > 0) {
                    Ubi.network.sendToHost('avatar:requestFrames', { sourceUrls });
                }
            }
        }

        if (event.type === EcsEventType.HOST_MESSAGE) {
            const m = event.payload as { type: string; payload: unknown };
            if (m.type === 'avatar:localFrames') {
                const { framesMap } = m.payload as { framesMap: Record<string, AnimFrame[]> };
                cursor.stateFrames = framesMap;
                cursor.animFrame = 0;
                cursor.animElapsed = 0;
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

    // アニメーション frame advance
    const currentState = cssToState(cursor.cursorStyle);
    const frames = cursor.stateFrames[currentState];
    if (frames && frames.length > 1) {
        cursor.animElapsed += deltaTime;
        const frameDuration = frames[cursor.animFrame]?.duration ?? 100;
        if (cursor.animElapsed >= frameDuration) {
            cursor.animElapsed -= frameDuration;
            cursor.animFrame = (cursor.animFrame + 1) % frames.length;
        }
    } else {
        cursor.animFrame = 0;
    }

    Ubi.ui.renderEntity(`user:${myUserId ?? 'unknown'}`, 'cursor', () => <AvatarCursor />);
};
