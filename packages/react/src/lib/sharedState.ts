/** 部屋の共有状態（state:get / state:update）の送受信。値の意味は呼ぶ側が持つ。 */
import type { ClientToServerEvents, SharedStateResult, SharedStateUpdate } from '@ubichill/shared';

export interface SharedStateSocket {
    emit<K extends 'state:get' | 'state:update'>(event: K, ...args: Parameters<ClientToServerEvents[K]>): unknown;
}

/** 応答と、時計のずれを測るための送受信の時刻。 */
export interface SharedStateReply {
    result: SharedStateResult;
    sentAt: number;
    receivedAt: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function call(
    send: (callback: (result: SharedStateResult) => void) => void,
    now: () => number,
    timeoutMs: number,
): Promise<SharedStateReply | null> {
    return new Promise((resolve) => {
        const sentAt = now();
        const timer = setTimeout(() => resolve(null), timeoutMs);
        send((result) => {
            clearTimeout(timer);
            resolve({ result, sentAt, receivedAt: now() });
        });
    });
}

/** 応答が無ければ null（操作の結果は不明。次の取得で合わせ直す）。 */
export function getSharedState(
    socket: SharedStateSocket,
    key: string,
    now: () => number = Date.now,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SharedStateReply | null> {
    return call((callback) => socket.emit('state:get', { key }, callback), now, timeoutMs);
}

export function updateSharedState(
    socket: SharedStateSocket,
    update: SharedStateUpdate,
    now: () => number = Date.now,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SharedStateReply | null> {
    return call((callback) => socket.emit('state:update', update, callback), now, timeoutMs);
}
