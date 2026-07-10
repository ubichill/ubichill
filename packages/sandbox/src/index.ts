/**
 * @ubichill/sandbox — Host-side entry point.
 *
 * Worker 管理・隔離実行のホスト API。プラグイン向け API は @ubichill/sdk から。
 *
 * 構成:
 *   host/   … main thread 側 (Worker 管理 / DOM 描画 / 入力収集 / fetch)
 *   worker/ … Worker (guest) 側の隔離実行環境エントリ
 */

// ── 権限: capability カタログ / 危険度 / ユーザーポリシー解決 ──
export {
    ALWAYS_ALLOWED_COMMANDS,
    buildAllowedCommands,
    CAPABILITY_COMMANDS,
    CAPABILITY_RISK,
    type CapabilityRisk,
    getCapabilityRisk,
} from './host/capability';
// ── infra: fetch / 診断 / DOM 描画 ──
export * from './host/fetchHandler';
// ── usecase: 個々の Worker のライフサイクル ──
export { PluginHostManager } from './host/PluginHostManager';
// ── repository: 在籍簿 + emit ルーティング ──
export { getActiveWorkerCount, resetRegistryForTests, routeEmit } from './host/PluginRegistry';
export {
    DEFAULT_PERMISSION_POLICY,
    type PermissionDecision,
    type PermissionPolicy,
    type ResolvedCapabilities,
    resolveCapabilities,
    resolveFetchDomains,
    type TierMode,
} from './host/permissionPolicy';
export * from './host/pluginDiagnostics';
// ── 型 ──
export type {
    FetchOptions,
    FetchResult,
    HostHandlers,
    PluginHostManagerOptions,
    PluginWorkerInfo,
} from './host/types';
export { renderVNode } from './host/VNodeRenderer';
