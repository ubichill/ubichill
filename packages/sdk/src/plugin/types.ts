// ============================================
// Plugin SDK 型定義
//
// @ubichill/shared からの型を再エクスポートし、
// プラグイン開発者が shared パッケージに依存しなくて済むようにします。
// ============================================

export type {
    // Avatar
    AppAvatarDef,
    CmdAvatarSet,
    CmdCustomMessage,
    CmdNetFetch,
    CmdReady,
    CmdSceneCreateEntity,
    CmdSceneDestroyEntity,
    // Commands
    CmdSceneGetEntity,
    CmdSceneSubscribeEntity,
    CmdSceneUnsubscribeEntity,
    CmdSceneUpdateCursor,
    CmdSceneUpdateEntity,
    CmdUiShowToast,
    CursorMovedCallback,
    CursorPosition,
    CustomEventCallback,
    EntityPatchPayload,
    EntityUpdatedCallback,
    EvtCustom,
    // Events
    EvtLifecycleInit,
    EvtLifecycleTick,
    EvtPlayerCursorMoved,
    EvtPlayerJoined,
    EvtPlayerLeft,
    EvtRpcResponse,
    EvtSceneEntityUpdated,
    PluginCommand,
    PluginEvent,
    // Plugin Protocol
    PluginGuestCommand,
    PluginHostEvent,
    RpcCreateEntityResult,
    // RPC Results
    RpcGetEntityResult,
    RpcNetFetchResult,
    // Callbacks
    TickCallback,
    // User
    User,
    UserJoinedCallback,
    UserLeftCallback,
    // World Entity
    WorldEntity,
} from '@ubichill/shared';
