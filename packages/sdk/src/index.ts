/**
 * Ubichill Plugin SDK - Main Export
 *
 * プラグイン開発で使用するすべての機能をエクスポート
 */

// Shared types (re-export for convenience)
export type {
    AvailableKind,
    CursorPosition,
    EntityEphemeralPayload,
    EntityPatchPayload,
    User,
    WorldEntity,
    WorldEnvironmentData,
} from '@ubichill/shared';
// Constants & Utils
export { Z_INDEX } from './constants';
export { useEntity } from './hooks/useEntity';
export { useObjectInteraction } from './hooks/useObjectInteraction';
export { SocketProvider, useSocket } from './hooks/useSocket';
export type { WorldContextType } from './hooks/useWorld';
// Re-export from frontend (these will be provided by the consuming app)
export { useWorld, WorldProvider } from './hooks/useWorld';
// Types
export type { WidgetDefinition } from './types';
