/**
 * Ubi.event — Worker からのトリガー送信 + 受信レジストリ。
 *
 * - sendToHost: 自 Worker → 自 Host (React 側) の片道通知。タブ内ローカル。
 * - broadcast:  自 Worker → ワールドの他ユーザーの同じ entity Worker。揮発性。
 * - emit:       自 Worker → 同 tab 内の他 Worker (scope + targetType でルーティング)。
 * - define:     型付きイベントレジストリを生成。emit/on/broadcast/sendToHost を
 *               1 つの schema に閉じこめ、type 文字列の typo・payload 不一致を
 *               コンパイル時に弾く。
 *
 * Reliable な状態同期は Ubi.state.sync を使うこと。
 */

import type { System } from '@ubichill/engine';
import { CommandType } from '@ubichill/shared';
import type { SendFn } from '../types';

/**
 * emit 配送のスコープ。すべて Entity 階層レベルの関係:
 *  - 'siblings':  同じ parent を持つ別 Entity の Component (空 wrapper Entity 下で兄弟同士を結ぶ)
 *  - 'parent':    自 Entity の親 Entity の Component
 *  - 'children':  自 Entity の直接の子 Entity の Component
 *  - 'subtree':   自 Entity + 子孫 全 Component
 *  - 'world':     全 Worker
 */
export type EmitScope = 'siblings' | 'parent' | 'children' | 'subtree' | 'world';

export interface EmitOptions {
    /** どの範囲の Worker を対象にするか。 */
    scope: EmitScope;
    /** 受信側 Component type フィルタ (`"modId:componentName"`)。省略時は scope 内の全 Component。 */
    targetType?: string;
}

/**
 * `Ubi.event.define<TMap>()` の戻り値。
 * TMap は `{ [eventType]: payload }` の形で定義する。
 *
 * ```ts
 * export const VPEvents = Ubi.event.define<{
 *   'vp:media:load':  { url: string; mode: 'video' | 'live' };
 *   'vp:media:seek':  { time: number };
 *   'vp:track:current': { track: Track | null; index: number; total: number };
 * }>();
 *
 * VPEvents.emit('vp:media:load', { url, mode: 'video' }, { scope: 'siblings', targetType: 'video-player:screen' });
 * VPEvents.on('vp:track:current', ({ track, index, total }) => { ... });
 * ```
 */
export interface EventRegistry<TMap extends Record<string, unknown>> {
    emit<K extends keyof TMap & string>(type: K, data: TMap[K], options: EmitOptions): void;
    broadcast<K extends keyof TMap & string>(type: K, data: TMap[K]): void;
    sendToHost<K extends keyof TMap & string>(type: K, data: TMap[K]): void;
    /**
     * emit / sendToHost / SDK 由来 (input:* / media:* / entity:* など) を受信する。
     * handler は event.payload をそのまま受け取る。
     * 戻り値の関数を呼ぶと unregister される。
     */
    on<K extends keyof TMap & string>(type: K, handler: (data: TMap[K]) => void): () => void;
    /**
     * broadcast (別ユーザーの Worker から飛んでくる cross-user メッセージ) を受信する。
     * SDK は内部で payload を `{ userId, data }` でラップして配信するため、
     * `on()` で受け取ると envelope のまま型が合わない。これは unwrap して (userId, data) で呼ぶ。
     */
    onBroadcast<K extends keyof TMap & string>(type: K, handler: (userId: string, data: TMap[K]) => void): () => void;
}

export type EventModuleDeps = {
    send: SendFn;
    registerSystem(system: System): void;
};

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
     * 同 tab 内の他 Worker に Component type を狙い撃ちでイベントを送る (untyped escape hatch)。
     * 通常は `Ubi.event.define()` で型付きレジストリを作る方を推奨。
     */
    emit(type: string, data: unknown, options: EmitOptions): void;
    /**
     * 型付きイベントレジストリを生成する。
     * emit/on/broadcast/sendToHost を 1 つの type ↔ payload 対応表で閉じこめる。
     */
    define<TMap extends Record<string, unknown>>(): EventRegistry<TMap>;
};

export function createEventModule(deps: EventModuleDeps): EventModule {
    const { send, registerSystem } = deps;

    const rawEmit = (type: string, data: unknown, options: EmitOptions): void =>
        send({
            type: CommandType.EVENT_EMIT,
            payload: { type, data, scope: options.scope, targetType: options.targetType },
        });
    const rawBroadcast = (type: string, data: unknown): void =>
        send({ type: CommandType.NETWORK_BROADCAST, payload: { type, data } });
    const rawSendToHost = (type: string, data: unknown): void =>
        send({ type: CommandType.NETWORK_SEND_TO_HOST, payload: { type, data } });

    return {
        sendToHost: rawSendToHost,
        broadcast: rawBroadcast,
        emit: rawEmit,
        define: <TMap extends Record<string, unknown>>(): EventRegistry<TMap> => {
            const handlers = new Map<string, Array<(data: unknown) => void>>();
            const broadcastHandlers = new Map<string, Array<(userId: string, data: unknown) => void>>();
            let dispatchRegistered = false;
            const ensureDispatcher = (): void => {
                if (dispatchRegistered) return;
                dispatchRegistered = true;
                registerSystem((_e, _dt, events) => {
                    for (const ev of events) {
                        const list = handlers.get(ev.type);
                        if (list) {
                            for (const h of list) h(ev.payload);
                        }
                        const blist = broadcastHandlers.get(ev.type);
                        if (blist) {
                            const env = ev.payload as { userId: string; data: unknown };
                            for (const h of blist) h(env.userId, env.data);
                        }
                    }
                });
            };

            const register = <H>(map: Map<string, H[]>, type: string, handler: H): (() => void) => {
                ensureDispatcher();
                let list = map.get(type);
                if (!list) {
                    list = [];
                    map.set(type, list);
                }
                list.push(handler);
                return () => {
                    const cur = map.get(type);
                    if (!cur) return;
                    const idx = cur.indexOf(handler);
                    if (idx >= 0) cur.splice(idx, 1);
                };
            };

            return {
                emit: (type, data, options) => rawEmit(type, data, options),
                broadcast: (type, data) => rawBroadcast(type, data),
                sendToHost: (type, data) => rawSendToHost(type, data),
                on: (type, handler) => register(handlers, type, handler as (data: unknown) => void),
                onBroadcast: (type, handler) =>
                    register(broadcastHandlers, type, handler as (userId: string, data: unknown) => void),
            };
        },
    };
}
