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
import {
    CommandType,
    FETCH_LIMITS,
    type ModGuestCommand,
    type ModWorkerMessage,
    normalizeFetchLimits,
    UbiError,
    UbiErrorCode,
} from '@ubichill/shared';
import { abortedFetchResult } from './fetchHandler';
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
    /** 取り消せるリクエストとして登録し、取り消し・制限時間で abort される signal を返す。 */
    openRequest(id: string, timeoutMs: number): AbortSignal;
    closeRequest(id: string): void;
    abortRequest(id: string): void;
    /** mod に同梱したアセットを integrity 照合のうえ読む。 */
    loadAsset(path: string, signal: AbortSignal): Promise<ArrayBuffer>;
}

/** promise と signal の abort のうち先に来た方で決着させる（ハンドラが signal を見なくても待ち続けない）。 */
async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => T): Promise<T> {
    if (signal.aborted) return onAbort();
    const aborted = Promise.withResolvers<T>();
    const listener = () => {
        try {
            aborted.resolve(onAbort());
        } catch (error) {
            aborted.reject(error);
        }
    };
    signal.addEventListener('abort', listener, { once: true });
    try {
        return await Promise.race([promise, aborted.promise]);
    } finally {
        signal.removeEventListener('abort', listener);
    }
}

function abortError(signal: AbortSignal): UbiError {
    const timedOut = (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError';
    return timedOut
        ? new UbiError(UbiErrorCode.FETCH_TIMEOUT, '制限時間内に読み込みが終わりませんでした')
        : new UbiError(UbiErrorCode.FETCH_ABORTED, '読み込みは取り消されました');
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
        case CommandType.NETWORK_FETCH: {
            const { options } = command.payload;
            const signal = ctx.openRequest(command.id, normalizeFetchLimits(options).timeoutMs);
            try {
                return await raceWithAbort(
                    handlers.onFetch?.(command.payload.url, options, { signal }) ?? Promise.resolve(undefined),
                    signal,
                    () => abortedFetchResult(signal, options?.responseType),
                );
            } finally {
                ctx.closeRequest(command.id);
            }
        }
        case CommandType.ASSET_LOAD: {
            const signal = ctx.openRequest(command.id, FETCH_LIMITS.defaultTimeoutMs);
            try {
                return await raceWithAbort(ctx.loadAsset(command.payload.path, signal), signal, () => {
                    throw abortError(signal);
                });
            } finally {
                ctx.closeRequest(command.id);
            }
        }
        case CommandType.IDENTITY_TOKEN: {
            // ドメイン承認の画面を待つことがあるので、fetch と同じ制限時間にする。
            const signal = ctx.openRequest(command.id, FETCH_LIMITS.defaultTimeoutMs);
            try {
                const issue =
                    handlers.onIdentityToken?.(command.payload.audience, { signal }) ??
                    Promise.reject(
                        new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, 'この Host は身元証明に対応していません'),
                    );
                return await raceWithAbort(issue, signal, () => {
                    throw abortError(signal);
                });
            } finally {
                ctx.closeRequest(command.id);
            }
        }
        case CommandType.CMD_ABORT:
            ctx.abortRequest(command.payload.requestId);
            return undefined;
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
        case CommandType.MEDIA_LOAD: {
            const options =
                command.payload.source && command.payload.loadId
                    ? {
                          source: command.payload.source,
                          targetId: command.payload.targetId,
                          presentation: command.payload.presentation ?? command.payload.kind,
                          sync: command.payload.sync,
                          deviceControl: command.payload.deviceControl,
                          loadId: command.payload.loadId,
                      }
                    : undefined;
            if (options) {
                await handlers.onMediaLoad?.(
                    command.payload.targetId,
                    command.payload.url,
                    command.payload.mediaType,
                    command.payload.kind,
                    options,
                );
            } else {
                await handlers.onMediaLoad?.(
                    command.payload.targetId,
                    command.payload.url,
                    command.payload.mediaType,
                    command.payload.kind,
                );
            }
            return undefined;
        }
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
            handlers.onGripCommand?.(command.payload, ctx.senderComponentInstanceId());
            return undefined;
        case CommandType.CMD_RIDE:
            handlers.onRideCommand?.(command.payload, ctx.senderComponentInstanceId());
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
