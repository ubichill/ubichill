// 権限ポリシーのヘルパー/型・診断ハンドラを再エクスポート（frontend は sandbox に直接依存しないため）。
export {
    type CapabilityInfo,
    type CapabilityRisk,
    DEFAULT_PERMISSION_POLICY,
    type DiagnosticLevel,
    describeCapability,
    getCapabilityRisk,
    listCapabilities,
    type ModDiagnostic,
    type PermissionDecision,
    type PermissionPolicy,
    resetDiagnosticHandler,
    setDiagnosticHandler,
    type TierMode,
} from '@ubichill/sandbox';
export type { HoldState } from './components/HoldContext';
export { HoldProvider, useHold } from './components/HoldContext';
export { ModUIMount } from './components/ModUIMount';
export type {
    PermissionContextValue,
    PermissionPromptRequest,
    PermissionProviderProps,
} from './components/PermissionContext';
export { PermissionProvider, useUbiPermissions } from './components/PermissionContext';
export type { WorkerModHostProps } from './components/WorkerModHost';
export { WorkerModHost } from './components/WorkerModHost';
export { editorSchemaRegistry, useEditorSchema } from './editorSchemaRegistry';
export { heldEntitySyncRef } from './heldEntitySyncRef';
export { useCursorPosition } from './hooks/useCursorPosition';
export { useEntity } from './hooks/useEntity';
export { useModCanvas } from './hooks/useModCanvas';
export { useModEntitySync } from './hooks/useModEntitySync';
export { useModPresence } from './hooks/useModPresence';
export { useModUI } from './hooks/useModUI';
export { useObjectInteraction } from './hooks/useObjectInteraction';
export type { SocketContextValue } from './hooks/useSocket';
export { SocketContext, SocketProvider, useSocket } from './hooks/useSocket';
export type { WorldContextType } from './hooks/useWorld';
export { useWorld, WorldContext, WorldProvider } from './hooks/useWorld';
export { type UseWorldModOptions, useWorldMod } from './hooks/useWorldMod';
export type { WidgetDefinition, WorkerModDefinition } from './types';
export { isWorkerMod } from './types';
export * from './useModWorker';
export * from './WorkerLoadingContext';
