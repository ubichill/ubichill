/**
 * @ubichill/sandbox — Host-side entry point.
 *
 * Worker 管理・隔離実行のホスト API。プラグイン向け API は @ubichill/sdk から。
 *
 * 構成:
 *   host/   … main thread 側 (Worker 管理 / DOM 描画 / 入力収集 / fetch)
 *   worker/ … Worker (guest) 側の隔離実行環境エントリ
 */

// ── infra: fetch / 診断 / DOM 描画 ──
export * from './host/fetchHandler';
// ── usecase: 個々の Worker のライフサイクル ──
export { PluginHostManager } from './host/PluginHostManager';
// ── repository: 在籍簿 + emit ルーティング ──
export { getActiveWorkerCount, resetRegistryForTests, routeEmit } from './host/PluginRegistry';
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
