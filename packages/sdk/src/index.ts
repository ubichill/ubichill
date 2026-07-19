/**
 * @ubichill/sdk — Mod developer public API
 *
 * mod開発者はここから import するだけで完結する。
 * 内部実装は @ubichill/ecs / @ubichill/sandbox に分離されている。
 *
 * Worker-safe（React・DOM 非依存）。
 * React / Host 側 API は '@ubichill/sdk/react' から。
 */

// ECS + メッセージング型
export * from '@ubichill/ecs';
// プロトコル型（@ubichill/shared より選択的に re-export）
export type {
    AvailableComponent,
    CanvasCursorData,
    CanvasStrokeData,
    CmdCanvasCommitStroke,
    CmdCanvasFrame,
    CmdLog,
    CmdNetworkBroadcast,
    CmdNetworkFetch,
    CmdNetworkSendToHost,
    CmdReady,
    CmdSceneCreateEntity,
    CmdSceneDestroyEntity,
    CmdSceneGetEntity,
    CmdSceneQueryEntities,
    CmdSceneSubscribeEntity,
    CmdSceneUnsubscribeEntity,
    CmdSceneUpdateEntity,
    CmdUiShowToast,
    ComponentInstance,
    CursorMovedCallback,
    CursorPosition,
    CustomEventCallback,
    EntityComponent,
    EntityEphemeralPayload,
    EntityPatchPayload,
    EntityUpdatedCallback,
    EvtCustom,
    EvtInput,
    EvtLifecycleInit,
    EvtLifecycleTick,
    EvtNetworkBroadcast,
    EvtPlayerCursorMoved,
    EvtPlayerJoined,
    EvtPlayerLeft,
    EvtRpcResponse,
    EvtSceneEntityUpdated,
    InputContextMenuData,
    InputFrameEvent,
    InputKeyDownData,
    InputKeyUpData,
    InputMouseDownData,
    InputMouseMoveData,
    InputMouseUpData,
    InputScrollData,
    ModCommand,
    ModEvent,
    ModGuestCommand,
    ModHostEvent,
    ModWorkerMessage,
    RpcCreateEntityResult,
    RpcGetEntityResult,
    RpcNetworkFetchResult,
    TickCallback,
    User,
    UserJoinedCallback,
    UserLeftCallback,
    UserStatus,
    WorldEntity,
    WorldEnvironmentData,
} from '@ubichill/shared';
// 統一エラー体系: modは UbiError / UbiErrorCode で失敗理由を判別できる
export { UbiError, UbiErrorCode } from '@ubichill/shared';
// UbiSDK クラス + 型
export { UbiSDK } from './ubi';
export type { EmitOptions, EmitScope, EventRegistry } from './ubi/event';
export type { Grip, GripOptions } from './ubi/grip';
export type { EntityState, EntityStateFor, OmitId, UiRenderCostStat } from './ubi/types';
// 宣言的 grip ラッパーは別 export path: '@ubichill/sdk/gripable'
// (sandbox / 他の sub-package が JSX なしで型解決できるよう main entry から分離)
