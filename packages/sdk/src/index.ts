/**
 * Ubichill Plugin SDK - Main Export
 *
 * プラグイン開発で使用するすべての機能をエクスポート
 * プラグインが依存してよいのはこのパッケージのみです。
 */

export type {
    AvailableKind,
    CursorPosition,
    CursorState,
    EntityEphemeralPayload,
    EntityPatchPayload,
    UserStatus,
    WorldEnvironmentData,
} from '@ubichill/shared';
// --- Constants ---
export { Z_INDEX } from './constants';
// --- Hooks ---
export { useEntity } from './hooks/useEntity';
export { useObjectInteraction } from './hooks/useObjectInteraction';
export { SocketProvider, useSocket } from './hooks/useSocket';
export type { WorldContextType } from './hooks/useWorld';
export { useWorld, WorldProvider } from './hooks/useWorld';
export * from './plugin/component';
// --- Plugin Worker SDK ---
export * from './plugin/guest';
export * from './plugin/host';
// --- Plugin Protocol & Entity Types (@ubichill/shared からの再エクスポート) ---
// プラグインは @ubichill/shared に直接依存せず、ここからインポートしてください。
export * from './plugin/types';
// --- Type-safe Messaging ---
export type {
    PluginHostMessage,
    PluginMessagingSchema,
    PluginWorkerMessage,
    TypedMessaging,
} from './plugin/messaging-types';
// --- ECS System ---
export type {
    ComponentDefinition,
    Entity,
    EcsWorld,
    Query,
    System,
    WorkerEvent,
} from './plugin/ecs/types';
export { EntityImpl, EcsWorldImpl, QueryImpl } from './plugin/ecs';

// --- Widget Types ---
export type { WidgetComponentProps, WidgetDefinition } from './types';
