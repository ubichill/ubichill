/**
 * Ubi.event — Worker からのトリガー送信。
 *
 * - sendToHost: 自 Worker → 自 Host (React 側) の片道通知。タブ内ローカル。
 * - broadcast:  自 Worker → ワールドの他ユーザーの同じ entity Worker。揮発性 (Reliable 保存なし)。
 *
 * Reliable な状態同期は Ubi.state.persistent を使うこと。
 */

import type { SendFn } from '../types';

export type EventModule = {
    sendToHost<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
    broadcast<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
};

export function createEventModule(send: SendFn): EventModule {
    return {
        sendToHost: (type, data) => send({ type: 'NETWORK_SEND_TO_HOST', payload: { type, data } }),
        broadcast: (type, data) => send({ type: 'NETWORK_BROADCAST', payload: { type, data } }),
    };
}
