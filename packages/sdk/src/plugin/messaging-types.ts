/**
 * Plugin Worker ↔ Host 間の型安全なメッセージング
 *
 * プラグイン開発者は、プラグイン独自の通信プロトコルを定義し、
 * 型安全に Worker ↔ Host でメッセージをやり取りできます。
 *
 * @example
 * ```ts
 * // plugins/pen/worker/src/types.ts
 * import type { PluginWorkerMessage } from '@ubichill/sdk';
 *
 * export type PenWorkerMessage = PluginWorkerMessage<
 *     'DRAWING_UPDATE' | 'STROKE_COMPLETE' | 'DRAWING_CLEAR',
 *     {
 *         DRAWING_UPDATE: { points: number[][] };
 *         STROKE_COMPLETE: { points: number[][] };
 *         DRAWING_CLEAR: Record<string, never>;
 *     }
 * >;
 *
 * // Worker 内
 * Ubi.messaging.send<PenWorkerMessage>('DRAWING_UPDATE', { points: [...] });
 *
 * // Host 側
 * const { sendEvent } = usePluginWorker<PenWorkerMessage>({
 *     onCommand: (command) => {
 *         if (command.type === 'CUSTOM_MESSAGE') {
 *             // command.payload は型安全
 *         }
 *     }
 * });
 * ```
 */

/**
 * Worker から Host へ送信されるメッセージの型定義
 *
 * @typeparam T - メッセージのタイプ識別子（リテラルユニオン）
 * @typeparam TPayloadMap - 各メッセージタイプに対応するペイロード型のマップ
 */
export interface PluginWorkerMessage<
    T extends string = string,
    TPayloadMap extends Record<T, unknown> = Record<T, unknown>,
> {
    type: T;
    payload: TPayloadMap[T];
}

/**
 * Host から Worker へ送信されるメッセージの型定義
 *
 * @typeparam T - メッセージのタイプ識別子（リテラルユニオン）
 * @typeparam TPayloadMap - 各メッセージタイプに対応するペイロード型のマップ
 */
export interface PluginHostMessage<
    T extends string = string,
    TPayloadMap extends Record<T, unknown> = Record<T, unknown>,
> {
    type: T;
    payload: TPayloadMap[T];
}

/**
 * プラグインの双方向通信プロトコルを定義するスキーマ
 *
 * @typeparam TWorkerMessages - Worker → Host のメッセージ型
 * @typeparam THostMessages - Host → Worker のメッセージ型
 */
export interface PluginMessagingSchema<
    TWorkerMessages extends PluginWorkerMessage = PluginWorkerMessage,
    THostMessages extends PluginHostMessage = PluginHostMessage,
> {
    worker: TWorkerMessages;
    host: THostMessages;
}

/**
 * 型安全なメッセージング API
 *
 * @typeparam TSchema -ご プラグインの通信スキーマ
 */
export interface TypedMessaging<TSchema extends PluginMessagingSchema = PluginMessagingSchema> {
    /**
     * ホストにメッセージを送信（単方向、応答なし）
     *
     * @param type メッセージタイプ
     * @param payload ペイロード（自動的に型チェックされます）
     *
     * @example
     * ```ts
     * Ubi.messaging.send('DRAWING_UPDATE', { points: [...] });
     * ```
     */
    send<K extends TSchema['worker']['type']>(
        type: K,
        payload: Extract<TSchema['worker'], { type: K }>['payload'],
    ): void;

    /**
     * ホストからのメッセージをリッスン
     *
     * @param type メッセージタイプ
     * @param callback ハンドラ（ペイロードは自動的に型チェック）
     * @returns 購読解除関数
     *
     * @example
     * ```ts
     * Ubi.messaging.on('MOUSE_MOVE', ({ x, y }) => {
     *     // x, y は型安全
     * });
     * ```
     */
    on<K extends TSchema['host']['type']>(
        type: K,
        callback: (payload: Extract<TSchema['host'], { type: K }>['payload']) => void,
    ): () => void;
}
