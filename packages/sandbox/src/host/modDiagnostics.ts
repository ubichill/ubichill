/**
 * modDiagnostics — modサンドボックスの診断・メトリクスレポーター
 *
 * ## 診断 (Diagnostic)
 * 警告・エラーを一括してハンドリング・フィルタリングする。
 * デフォルトは console.warn / console.error に出力する。
 * `setDiagnosticHandler` で差し替え可能（UIパネル、Sentry等）。
 *
 * ## メトリクス (Metric)
 * パフォーマンス推定用の計測値を収集する。
 * デフォルトは何もしない（オプトイン）。
 * `setMetricHandler` でハンドラーを登録することで計測を開始する。
 */

// ============================================================
// 診断 (Diagnostic)
// ============================================================

import type { UbiErrorCode } from '@ubichill/shared';

export type DiagnosticLevel = 'warn' | 'error';

export interface ModDiagnostic {
    /** 警告レベル */
    level: DiagnosticLevel;
    /** 発生元modID */
    modId: string;
    /** 機械可読なエラーコード (統一エラー体系 UbiErrorCode) */
    code: DiagnosticCode;
    /** 人間可読なメッセージ */
    message: string;
    /**
     * 拒否を「クリックで許可」に変えるための再承認情報（UI が「許可」ボタンを出す）。
     * modId は "mod:component" 形式のことがあるので、消費側で ":" 前に正規化する。
     */
    retry?: { modId: string; capability: string } | { modId: string; domain: string };
}

/**
 * 診断コードは統一エラー体系 UbiErrorCode のサブセット。
 * Host 内部の診断 (warn/error) で使うものに限定する。
 */
export type DiagnosticCode = UbiErrorCode;

export type DiagnosticHandler = (diagnostic: ModDiagnostic) => void;

const _defaultDiagnosticHandler: DiagnosticHandler = ({ level, modId, code, message }) => {
    console[level](`[Mod:${modId}] [${code}] ${message}`);
};

let _diagnosticHandler: DiagnosticHandler = _defaultDiagnosticHandler;

/**
 * 診断ハンドラーをカスタム実装に差し替える。
 * @example
 * setDiagnosticHandler(({ level, modId, code, message }) => {
 *   myLogger.log({ level, modId, code, message });
 * });
 */
export function setDiagnosticHandler(handler: DiagnosticHandler): void {
    _diagnosticHandler = handler;
}

/** 診断ハンドラーをデフォルト（console）に戻す */
export function resetDiagnosticHandler(): void {
    _diagnosticHandler = _defaultDiagnosticHandler;
}

/**
 * 同一診断（modId+code+message）の連投を抑制する窓 (ms)。
 * 拒否コマンドを毎フレーム送るmodで console/トーストが洪水になるのを防ぐ。
 */
const DIAGNOSTIC_THROTTLE_MS = 3000;
const _recentDiagnostics = new Map<string, number>();

/** ModHostManager 内部から呼ぶ診断レポート関数（同一診断はレート制限する）。 */
export function reportDiagnostic(diagnostic: ModDiagnostic): void {
    const key = `${diagnostic.modId}:${diagnostic.code}:${diagnostic.message}`;
    const now = Date.now();
    const last = _recentDiagnostics.get(key);
    if (last !== undefined && now - last < DIAGNOSTIC_THROTTLE_MS) return; // 直近に同一診断あり → 抑制

    // Map の無制限成長を防ぐ（distinct メッセージ数は少ないが念のため）。
    if (_recentDiagnostics.size > 200) _recentDiagnostics.clear();
    _recentDiagnostics.set(key, now);
    _diagnosticHandler(diagnostic);
}

/** テスト用: レート制限の記録をリセットする。 */
export function resetDiagnosticThrottleForTests(): void {
    _recentDiagnostics.clear();
}

// ============================================================
// メトリクス (Metric)
// ============================================================

/**
 * 1Tick あたりのパフォーマンス計測値。
 *
 * - `deltaMs`: rAF の実フレーム間隔。16.67ms 超えはフレーム落ちを示す。
 * - `commandProcessingMs`: ホスト側でそのTickに受信したWorkerコマンドの処理累積時間。
 *    描画・エンティティ更新などのホスト処理コストを示す。
 *    Worker内部の処理時間は含まれない（Worker→Hostの通信は非同期のため）。
 * - `activeWorkerCount`: 計測時点でのアクティブWorker総数。
 */
export interface TickMetric {
    modId: string;
    componentInstanceId: string | undefined;
    deltaMs: number;
    commandProcessingMs: number;
    activeWorkerCount: number;
    timestamp: number;
}

export type MetricHandler = (metric: TickMetric) => void;

/** デフォルトは no-op（オプトイン設計） */
let _metricHandler: MetricHandler | null = null;

/**
 * メトリクスハンドラーを登録する。登録することで計測が有効になる。
 * @example
 * setMetricHandler((metric) => {
 *   console.table(metric);
 * });
 */
export function setMetricHandler(handler: MetricHandler): void {
    _metricHandler = handler;
}

/** メトリクスハンドラーを解除する（計測停止） */
export function clearMetricHandler(): void {
    _metricHandler = null;
}

/** ModHostManager 内部から呼ぶメトリクスレポート関数 */
export function reportMetric(metric: TickMetric): void {
    _metricHandler?.(metric);
}

/** メトリクスハンドラーが登録されているか（計測が有効か） */
export function isMetricEnabled(): boolean {
    return _metricHandler !== null;
}
