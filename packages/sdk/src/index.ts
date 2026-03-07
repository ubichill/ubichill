/**
 * @ubichill/sdk — Plugin developer public API
 *
 * プラグイン開発者はここから import するだけで完結する。
 * 内部実装は @ubichill/engine / @ubichill/sandbox に分離されている。
 *
 * Worker-safe（React・DOM 非依存）。
 * React / Host 側 API は '@ubichill/sdk/react' から。
 */

// ECS + メッセージング型
export * from '@ubichill/engine';
// UbiSDK 型（プラグイン Worker の `declare const Ubi: UbiSDK` 用）
export type { UbiSDK } from '@ubichill/sandbox';
// プロトコル型（@ubichill/shared より選択的に re-export）
export type {
    AppAvatarDef,
    AvailableKind,
    CmdAvatarSet,
    CmdCustomMessage,
    CmdNetFetch,
    CmdReady,
    CmdSceneCreateEntity,
    CmdSceneDestroyEntity,
    CmdSceneGetEntity,
    CmdSceneSubscribeEntity,
    CmdSceneUnsubscribeEntity,
    CmdSceneUpdateCursor,
    CmdSceneUpdateEntity,
    CmdUiShowToast,
    CursorMovedCallback,
    CursorPosition,
    CursorState,
    CustomEventCallback,
    EntityEphemeralPayload,
    EntityPatchPayload,
    EntityUpdatedCallback,
    EvtCustom,
    EvtLifecycleInit,
    EvtLifecycleTick,
    EvtPlayerCursorMoved,
    EvtPlayerJoined,
    EvtPlayerLeft,
    EvtRpcResponse,
    EvtSceneEntityUpdated,
    PluginCommand,
    PluginEvent,
    PluginGuestCommand,
    PluginHostEvent,
    RpcCreateEntityResult,
    RpcGetEntityResult,
    RpcNetFetchResult,
    TickCallback,
    User,
    UserJoinedCallback,
    UserLeftCallback,
    UserStatus,
    WorldEntity,
    WorldEnvironmentData,
} from '@ubichill/shared';
