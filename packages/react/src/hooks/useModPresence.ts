/**
 * useModPresence
 *
 * singleton WorkerMod 向け。users マップの変化を
 * EVT_PLAYER_JOINED / EVT_PLAYER_CURSOR_MOVED / EVT_PLAYER_LEFT として Worker へ転送する。
 *
 * - Worker 再作成時（workerRevision 変化）は全ユーザーを再送
 * - 位置変化のみの場合は EVT_PLAYER_CURSOR_MOVED のみ（JOINED は送らない）
 * - メタ情報変化（名前・アバター・cursorState）は EVT_PLAYER_JOINED で再送
 */

import type { ModHostEvent, User } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import type { WorkerModDefinition } from '../types';

export function useModPresence(
    definition: WorkerModDefinition,
    users: Map<string, User>,
    sendEvent: (event: ModHostEvent) => void,
    workerRevision: number,
): void {
    const prevUsersRef = useRef<Map<string, User>>(new Map());
    const prevWorkerRevisionRef = useRef(-1);

    useEffect(() => {
        if (!definition.singleton) return;

        const workerReset = prevWorkerRevisionRef.current !== workerRevision;
        prevWorkerRevisionRef.current = workerRevision;

        const prev = prevUsersRef.current;
        const next = users;

        if (workerReset) {
            for (const user of next.values()) {
                sendEvent({ type: 'EVT_PLAYER_JOINED', payload: { user } });
                if (user.position) {
                    sendEvent({
                        type: 'EVT_PLAYER_CURSOR_MOVED',
                        payload: { userId: user.id, position: user.position },
                    });
                }
            }
        } else {
            for (const [id, user] of next) {
                if (!prev.has(id)) {
                    sendEvent({ type: 'EVT_PLAYER_JOINED', payload: { user } });
                } else if (prev.get(id) !== user) {
                    const prevUser = prev.get(id);
                    if (!prevUser) continue;
                    const positionChanged = prevUser.position !== user.position;
                    const metaChanged =
                        prevUser.name !== user.name ||
                        prevUser.avatarUrl !== user.avatarUrl ||
                        prevUser.cursorUrl !== user.cursorUrl ||
                        prevUser.penColor !== user.penColor;
                    if (positionChanged) {
                        sendEvent({
                            type: 'EVT_PLAYER_CURSOR_MOVED',
                            payload: { userId: user.id, position: user.position },
                        });
                    }
                    if (metaChanged) {
                        sendEvent({ type: 'EVT_PLAYER_JOINED', payload: { user } });
                    }
                }
            }
            for (const id of prev.keys()) {
                if (!next.has(id)) {
                    sendEvent({ type: 'EVT_PLAYER_LEFT', payload: { userId: id } });
                }
            }
        }
        prevUsersRef.current = next;
    }, [users, definition.singleton, sendEvent, workerRevision]);
}
