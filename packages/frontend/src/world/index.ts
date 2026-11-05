/**
 * `src/world` — ワールドを動かす部分（mod の取得と確認・Worker の実行・描画・入室の流れ）。
 * SNS の画面（InstancePage・World Editor）と `world.html` の両方がここから使う。
 * この下のコードは SNS（認証・router・backend API）を読み込まない（scripts/architecture.mjs の規則）。
 */
export { buildWorldLock } from './buildWorldLock';
export { DEV_HOST } from './devHost';
export { EntityRenderer } from './EntityRenderer';
export { ModRegistryProvider, useModRegistry } from './ModRegistryContext';
export { checkModInstallation, type ModInstallationCheck } from './modInstallation';
export { describeModRejection } from './modRejection';
export { isUnsignedModAllowed, type ModAuthorCheck, modAuthorFetcher } from './modSignature';
export type { ModSource } from './modSource';
export { createGuestResolver, fetchGuestInstance, isJoinRejection, presenceToInstance } from './runtimeApi';
export { ENTRY_DECLINED_MESSAGE, WorldView, type WorldViewProps } from './WorldView';
