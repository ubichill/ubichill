/**
 * Ubi.event — Worker からのトリガー送信。
 *
 * - sendToHost: 自 Worker → 自 Host (React 側) の片道通知。タブ内ローカル。
 * - broadcast:  自 Worker → ワールドの他ユーザーの同じ entity Worker。揮発性 (Reliable 保存なし)。
 * - emit:       自 Worker → 同 tab 内の他 Worker (scope + targetType でルーティング)。
 *
 * Reliable な状態同期は Ubi.state.sync を使うこと。
 */

import type { SendFn } from '../types';

export type EmitScope = 'siblings' | 'parent' | 'children' | 'subtree' | 'world';

export interface EmitOptions {
    /** どの範囲の Worker を対象にするか。 */
    scope: EmitScope;
    /** 受信側 Component type フィルタ (`"pluginId:componentName"`)。省略時は scope 内の全 Component。 */
    targetType?: string;
}

export type EventModule = {
    sendToHost<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
    broadcast<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
    /**
     * 同 tab 内の他 Worker に Component type を狙い撃ちでイベントを送る。
     *
     * ```ts
     * Ubi.event.emit('PLAY_VIDEO', { url }, {
     *   scope: 'siblings',
     *   targetType: 'video-player:screen',
     * });
     * ```
     *
     * 受信側では System の events として `event.type === 'PLAY_VIDEO'` で届く。
     * capability: 'net:emit' が必要。
     */
    emit(type: string, data: unknown, options: EmitOptions): void;
};

export function createEventModule(send: SendFn): EventModule {
    return {
        sendToHost: (type, data) => send({ type: 'NETWORK_SEND_TO_HOST', payload: { type, data } }),
        broadcast: (type, data) => send({ type: 'NETWORK_BROADCAST', payload: { type, data } }),
        emit: (type, data, options) =>
            send({
                type: 'EVENT_EMIT',
                payload: { type, data, scope: options.scope, targetType: options.targetType },
            }),
    };
}
