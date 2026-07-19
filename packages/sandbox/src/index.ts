/**
 * @ubichill/sandbox — Host-side entry point.
 *
 * Worker 管理・隔離実行のホスト API。mod向け API は @ubichill/sdk から。
 *
 * 構成:
 *   host/   … main thread 側 (Worker 管理 / DOM 描画 / 入力収集 / fetch)
 *   worker/ … Worker (guest) 側の隔離実行環境エントリ
 */

// ── 権限の enforcement ゲート（実行時判定）。カタログ/ポリシーの「知識」は @ubichill/shared へ移設済み ──
export { type CapabilityGate, type CapabilityGateOptions, createCapabilityGate } from './host/capabilityGate';
// ── infra: fetch / 診断 / DOM 描画 ──
export * from './host/fetchHandler';
// ── usecase: 個々の Worker のライフサイクル ──
export { ModHostManager } from './host/ModHostManager';
// ── repository: 在籍簿 + emit ルーティング ──
export { getActiveWorkerCount, resetRegistryForTests, routeEmit } from './host/ModRegistry';
export * from './host/modDiagnostics';
// ── 型 ──
export type {
    FetchOptions,
    FetchResult,
    HostHandlers,
    ModHostManagerOptions,
    ModWorkerInfo,
} from './host/types';
