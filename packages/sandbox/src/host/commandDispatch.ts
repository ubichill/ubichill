/**
 * commandDispatch — Worker からの ModGuestCommand を HostHandlers へ振り分ける。
 *
 * ModHostManager から分離した「コマンドルーティング」の関心事。新しいコマンドを足すときは
 * ここに 1 case 足すだけでよい（Manager 本体は触らない）。判別可能ユニオンの switch なので
 * payload は型安全に narrowing される。
 *
 * RPC（id を持つコマンド）の戻り値は dispatchCommand の返り値になり、Manager が
 * EVT_RPC_RESPONSE に載せる。fire-and-forget は undefined を返す。
 */
import { CommandType, type ModGuestCommand, type ModWorkerMessage } from '@ubichill/shared';
import type { HostHandlers } from './types';

/** RPC タイムアウトを型で判別するための専用エラー（文字列マッチをやめるため）。 */
export class RpcTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RpcTimeoutError';
    }
}

/** dispatchCommand が必要とする Manager 側のコンテキスト。 */
export interface CommandContext<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> {
    handlers: HostHandlers<TPayloadMap>;
    /** RPC ハンドラにタイムアウトを付ける（Manager の静的値を使う）。 */
    withTimeout<T>(promise: Promise<T>, cmdType: string): Promise<T>;
    /** EVENT_EMIT の senderComponentInstanceId を解決する。 */
    senderComponentInstanceId(): string | undefined;
    /** CMD_LOG のフォールバック console 出力用プレフィックス。 */
    logPrefix: string;
}

/**
 * コマンドを対応する HostHandler に振り分けて実行する。
 * RPC の戻り値（SCENE_CREATE の id / NETWORK_FETCH の結果 / SCENE_GET・QUERY の値）を返す。
 */
export async function dispatchCommand<TPayloadMap extends Record<string, unknown>>(
    command: ModGuestCommand,
    ctx: CommandContext<TPayloadMap>,
): Promise<unknown> {
    const { handlers, withTimeout } = ctx;
    switch (command.type) {
        case CommandType.SCENE_GET_ENTITY:
            return handlers.onGetEntity?.(command.payload.id) ?? null;
        case CommandType.SCENE_QUERY_ENTITIES:
            return handlers.onQueryEntities?.(command.payload.entityType) ?? [];
        case CommandType.SCENE_CREATE_ENTITY:
            return (
                await withTimeout(
                    handlers.onCreateEntity?.(command.payload.entity) ?? Promise.resolve(undefined),
                    command.type,
                )
            )?.id;
        case CommandType.SCENE_UPDATE_ENTITY:
            await withTimeout(
                handlers.onUpdateEntity?.(command.payload.id, command.payload.patch) ?? Promise.resolve(),
                command.type,
            );
            return undefined;
        case CommandType.SCENE_DESTROY_ENTITY:
            await withTimeout(handlers.onDestroyEntity?.(command.payload.id) ?? Promise.resolve(), command.type);
            return undefined;
        case CommandType.NETWORK_FETCH:
            return withTimeout(
                handlers.onFetch?.(command.payload.url, command.payload.options) ?? Promise.resolve(undefined),
                command.type,
            );
        case CommandType.NETWORK_SEND_TO_HOST:
            handlers.onMessage?.({
                type: command.payload.type,
                payload: command.payload.data,
            } as ModWorkerMessage<TPayloadMap>);
            return undefined;
        case CommandType.NETWORK_BROADCAST:
            handlers.onNetworkBroadcast?.(command.payload.type, command.payload.data);
            return undefined;
        case CommandType.EVENT_EMIT:
            handlers.onEventEmit?.(
                command.payload.type,
                command.payload.data,
                command.payload.scope,
                command.payload.targetType,
                ctx.senderComponentInstanceId(),
            );
            return undefined;
        case CommandType.UI_RENDER:
            handlers.onRender?.(command.payload.targetId, command.payload.vnode);
            return undefined;
        case CommandType.EDITOR_SCHEMA:
            handlers.onEditorSchema?.(command.payload.componentType, command.payload.schema);
            return undefined;
        case CommandType.CANVAS_FRAME:
            handlers.onCanvasFrame?.(command.payload.targetId, command.payload.activeStroke, command.payload.cursors);
            return undefined;
        case CommandType.CANVAS_COMMIT_STROKE:
            handlers.onCanvasCommitStroke?.(command.payload.targetId, command.payload.stroke);
            return undefined;
        case CommandType.MEDIA_LOAD:
            handlers.onMediaLoad?.(command.payload.targetId, command.payload.url, command.payload.mediaType);
            return undefined;
        case CommandType.MEDIA_PLAY:
            handlers.onMediaPlay?.(command.payload.targetId);
            return undefined;
        case CommandType.MEDIA_PAUSE:
            handlers.onMediaPause?.(command.payload.targetId);
            return undefined;
        case CommandType.MEDIA_SEEK:
            handlers.onMediaSeek?.(command.payload.targetId, command.payload.time);
            return undefined;
        case CommandType.MEDIA_SET_VOLUME:
            handlers.onMediaSetVolume?.(command.payload.targetId, command.payload.volume);
            return undefined;
        case CommandType.MEDIA_DESTROY:
            handlers.onMediaDestroy?.(command.payload.targetId);
            return undefined;
        case CommandType.MEDIA_SET_VISIBLE:
            handlers.onMediaSetVisible?.(command.payload.targetId, command.payload.visible);
            return undefined;
        case CommandType.MEDIA_SET_DEVICE_CONTROL:
            handlers.onMediaSetDeviceControl?.(command.payload.targetId, command.payload.enabled);
            return undefined;
        case CommandType.CMD_GRIP:
            handlers.onGripCommand?.(command.payload);
            return undefined;
        case CommandType.CMD_LOG: {
            const { level, message } = command.payload;
            if (handlers.onLog) {
                handlers.onLog(level, message, ctx.logPrefix);
            } else {
                console[level](`${ctx.logPrefix} ${message}`);
            }
            return undefined;
        }
        default:
            handlers.onCommand?.(command);
            return undefined;
    }
}
