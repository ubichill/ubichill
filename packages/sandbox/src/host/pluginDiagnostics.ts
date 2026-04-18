/**
 * pluginDiagnostics — プラグインサンドボックスの診断・メトリクスレポーター
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

export type DiagnosticLevel = 'warn' | 'error';

export interface PluginDiagnostic {
    /** 警告レベル */
    level: DiagnosticLevel;
    /** 発生元プラグインID */
    pluginId: string;
    /** 機械可読なエラーコード */
    code: DiagnosticCode;
    /** 人間可読なメッセージ */
    message: string;
}

/**
 * 診断コード一覧。
 * 新しい警告を追加するときはここに追記する。
 */
export type DiagnosticCode =
    /** Worker がコマンドを送ったが対応するハンドラーが未接続 */
    | 'HANDLER_NOT_CONNECTED'
    /** 宣言されていない capability を使用しようとした */
    | 'CAPABILITY_VIOLATION'
    /** 実行時間・メモリ制限を超過した */
    | 'RESOURCE_LIMIT_EXCEEDED'
    /** Tick のコマンド処理時間がフレーム予算を超過した */
    | 'PERF_TICK_BUDGET_EXCEEDED'
    /** アクティブ Worker 数が上限に達した */
    | 'PERF_WORKER_LIMIT_REACHED';

export type DiagnosticHandler = (diagnostic: PluginDiagnostic) => void;

const _defaultDiagnosticHandler: DiagnosticHandler = ({ level, pluginId, code, message }) => {
    console[level](`[Plugin:${pluginId}] [${code}] ${message}`);
};

let _diagnosticHandler: DiagnosticHandler = _defaultDiagnosticHandler;

/**
 * 診断ハンドラーをカスタム実装に差し替える。
 * @example
 * setDiagnosticHandler(({ level, pluginId, code, message }) => {
 *   myLogger.log({ level, pluginId, code, message });
 * });
 */
export function setDiagnosticHandler(handler: DiagnosticHandler): void {
    _diagnosticHandler = handler;
}

/** 診断ハンドラーをデフォルト（console）に戻す */
export function resetDiagnosticHandler(): void {
    _diagnosticHandler = _defaultDiagnosticHandler;
}

/** PluginHostManager 内部から呼ぶ診断レポート関数 */
export function reportDiagnostic(diagnostic: PluginDiagnostic): void {
    _diagnosticHandler(diagnostic);
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
    pluginId: string;
    entityId: string | undefined;
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

/** PluginHostManager 内部から呼ぶメトリクスレポート関数 */
export function reportMetric(metric: TickMetric): void {
    _metricHandler?.(metric);
}

/** メトリクスハンドラーが登録されているか（計測が有効か） */
export function isMetricEnabled(): boolean {
    return _metricHandler !== null;
}
