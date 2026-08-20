/**
 * @ubichill/sdk — Mod developer public API
 *
 * mod開発者はここから import するだけで完結する。
 * 内部実装は @ubichill/ecs / @ubichill/sandbox に分離されている。
 *
 * Worker-safe（React・DOM 非依存）。
 * React / Host 側 API は Host パッケージ（@ubichill/react）に分離されている。
 */

// Host標準のdata-only Component。modは予約型を生成・更新できないが、公開された
// 型と純粋なgeometry関数を使ってHostから渡されたColliderを高速に判定できる。
export {
    CORE_COMPONENT_TYPES,
    type ColliderData,
    type ColliderGeometry,
    matchesCollisionLayers,
    overlaps,
    resolveColliderGeometry,
} from '@ubichill/core-components/public';
// ECS + メッセージング型
export * from '@ubichill/ecs';
// プロトコル型（@ubichill/shared より選択的に re-export）。
// barrel（'@ubichill/shared'）ではなく個別サブパスから import する: barrel は
// schemas/* の zod スキーマ群を抱えており、経由すると SDK の型定義バンドル生成
// （dts-bundle-generator）が実測で約80倍遅くなる（21秒 → 250ms、mod/entities.ts 参照）。
export type {
    AvailableComponent,
    ComponentInstance,
    CursorPosition,
    EntityComponent,
    EntityEphemeralPayload,
    EntityPatchPayload,
    User,
    UserStatus,
    WorldEntity,
    WorldEnvironmentData,
} from '@ubichill/shared/mod/entities';
// 統一エラー体系: modは UbiError / UbiErrorCode で失敗理由を判別できる
export { UbiError, UbiErrorCode } from '@ubichill/shared/mod/errors';
// このSDKが対応するワイヤープロトコルのバージョン（Host側 @ubichill/sandbox が実行時に
// ハンドシェイクする値と同じ定数）。SDKのnpm semverはこの値と自動連動しないため、
// mod開発者が「このSDKでビルドしたmodがどのHostバージョンと噛み合うか」を確認する
// 目安として公開する。実際の互換性チェックは Host 側の checkProtocolCompatibility が担う。
export { PROTOCOL_VERSION } from '@ubichill/shared/mod/protocol';
export type {
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
    CursorMovedCallback,
    CustomEventCallback,
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
    UserJoinedCallback,
    UserLeftCallback,
} from '@ubichill/shared/mod/types';
export type { Ubi } from './ubi';
// UbiSDK クラス（実装） + mod 向け公開型
export { UbiSDK } from './ubi';
export type { ComponentConfig, DataField, DataFieldType } from './ubi/config';
export type { EmitOptions, EmitScope, EventRegistry } from './ubi/event';
export type { Grip, GripOptions } from './ubi/grip';
export type { Ride } from './ubi/ride';
export type { EntityState, EntityStateFor, OmitId, UiRenderCostStat } from './ubi/types';
// 宣言的 grip ラッパーは別 export path: '@ubichill/sdk/gripable'
// (sandbox / 他の sub-package が JSX なしで型解決できるよう main entry から分離)
