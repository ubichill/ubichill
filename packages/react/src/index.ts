// 権限ポリシーのヘルパー/型を再エクスポート（frontend は sandbox に直接依存しないため）。
export {
    type CapabilityInfo,
    type CapabilityRisk,
    DEFAULT_PERMISSION_POLICY,
    describeCapability,
    getCapabilityRisk,
    listCapabilities,
    type PermissionDecision,
    type PermissionPolicy,
    type TierMode,
} from '@ubichill/sandbox';
export type { HoldState } from './components/HoldContext';
export { HoldProvider, useHold } from './components/HoldContext';
export type {
    PermissionContextValue,
    PermissionPromptRequest,
    PermissionProviderProps,
} from './components/PermissionContext';
export { PermissionProvider, useUbiPermissions } from './components/PermissionContext';
export { PluginUIMount } from './components/PluginUIMount';
export type { WorkerPluginHostProps } from './components/WorkerPluginHost';
export { WorkerPluginHost } from './components/WorkerPluginHost';
export { editorSchemaRegistry, useEditorSchema } from './editorSchemaRegistry';
export { heldEntitySyncRef } from './heldEntitySyncRef';
export { useCursorPosition } from './hooks/useCursorPosition';
export { useEntity } from './hooks/useEntity';
export { useObjectInteraction } from './hooks/useObjectInteraction';
export { usePluginCanvas } from './hooks/usePluginCanvas';
export { usePluginEntitySync } from './hooks/usePluginEntitySync';
export { usePluginPresence } from './hooks/usePluginPresence';
export { usePluginUI } from './hooks/usePluginUI';
export type { SocketContextValue } from './hooks/useSocket';
export { SocketContext, SocketProvider, useSocket } from './hooks/useSocket';
export type { WorldContextType } from './hooks/useWorld';
export { useWorld, WorldContext, WorldProvider } from './hooks/useWorld';
export { type UseWorldPluginOptions, useWorldPlugin } from './hooks/useWorldPlugin';
export type { WidgetDefinition, WorkerPluginDefinition } from './types';
export { isWorkerPlugin } from './types';
export * from './usePluginWorker';
export * from './WorkerLoadingContext';
