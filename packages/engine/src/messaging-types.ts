/**
 * Plugin Worker ↔ Host 間の型安全なメッセージング
 */

export interface PluginWorkerMessage<
    T extends string = string,
    TPayloadMap extends Record<T, unknown> = Record<T, unknown>,
> {
    type: T;
    payload: TPayloadMap[T];
}

export interface PluginHostMessage<
    T extends string = string,
    TPayloadMap extends Record<T, unknown> = Record<T, unknown>,
> {
    type: T;
    payload: TPayloadMap[T];
}

export interface PluginMessagingSchema<
    TWorkerMessages extends PluginWorkerMessage = PluginWorkerMessage,
    THostMessages extends PluginHostMessage = PluginHostMessage,
> {
    worker: TWorkerMessages;
    host: THostMessages;
}

export interface TypedMessaging<TSchema extends PluginMessagingSchema = PluginMessagingSchema> {
    send<K extends TSchema['worker']['type']>(
        type: K,
        payload: Extract<TSchema['worker'], { type: K }>['payload'],
    ): void;

    on<K extends TSchema['host']['type']>(
        type: K,
        callback: (payload: Extract<TSchema['host'], { type: K }>['payload']) => void,
    ): () => void;
}
