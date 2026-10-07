/**
 * Ubichill mod基盤の統一エラー体系。
 *
 * Worker (mod開発者) と Host (基盤) の双方が同じ `UbiErrorCode` を共有することで、
 * 「なぜ失敗したか」を文字列ではなく machine-readable な code で判別できる。
 *
 *   - Worker 側: `catch (e) { if (e instanceof UbiError && e.code === UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED) ... }`
 *   - Host 側  : RPC レスポンスや診断レポートに code を載せて返す
 *
 * カテゴリ接頭辞でグルーピングしている (FETCH_ / RPC_ / CAPABILITY_ / WORKER_ / PERF_ / RESOURCE_)。
 */

export const UbiErrorCode = {
    // ── capability ──
    /** mod.json で宣言されていない capability のコマンドを使った */
    CAPABILITY_NOT_DECLARED: 'CAPABILITY_NOT_DECLARED',
    /** ユーザーがこの権限を拒否した (on-demand 承認で deny を選択、またはポリシーで deny) */
    CAPABILITY_DENIED: 'CAPABILITY_DENIED',

    // ── RPC ──
    /** RPC が時間内に応答しなかった */
    RPC_TIMEOUT: 'RPC_TIMEOUT',
    /** Host 側ハンドラが例外を投げた */
    RPC_HANDLER_ERROR: 'RPC_HANDLER_ERROR',
    /** コマンドに対応する Host ハンドラが接続されていない */
    HANDLER_NOT_CONNECTED: 'HANDLER_NOT_CONNECTED',

    // ── fetch (Ubi.fetch) ──
    /** allowlist に無いドメイン */
    FETCH_DOMAIN_NOT_ALLOWED: 'FETCH_DOMAIN_NOT_ALLOWED',
    /** https 以外のスキーム */
    FETCH_HTTPS_REQUIRED: 'FETCH_HTTPS_REQUIRED',
    /** URL としてパースできない */
    FETCH_INVALID_URL: 'FETCH_INVALID_URL',
    /** fetch 自体が throw した (ネットワーク断・CORS 等) */
    FETCH_NETWORK_ERROR: 'FETCH_NETWORK_ERROR',
    /** 制限時間（timeoutMs）内に終わらなかった */
    FETCH_TIMEOUT: 'FETCH_TIMEOUT',
    /** 本文が上限（maxBytes）を超えた */
    FETCH_RESPONSE_TOO_LARGE: 'FETCH_RESPONSE_TOO_LARGE',
    /** mod が AbortSignal で取り消した */
    FETCH_ABORTED: 'FETCH_ABORTED',

    // ── asset (Ubi.asset) ──
    /** mod の versioned ディレクトリの外を指すパス */
    ASSET_INVALID_PATH: 'ASSET_INVALID_PATH',
    /** manifest の assetIntegrity に載っていないアセット */
    ASSET_NOT_DECLARED: 'ASSET_NOT_DECLARED',
    /** 取得したバイト列が manifest の integrity と一致しない */
    ASSET_INTEGRITY_MISMATCH: 'ASSET_INTEGRITY_MISMATCH',
    /** アセットを取得できなかった（HTTP エラー・通信失敗） */
    ASSET_FETCH_FAILED: 'ASSET_FETCH_FAILED',

    // ── runtime ──
    /** 実行環境（ブラウザ・Host）がその機能を持たない */
    UNSUPPORTED_FEATURE: 'UNSUPPORTED_FEATURE',

    // ── worker lifecycle ──
    /** Worker 初期化に失敗した (modコードの構文エラー等) */
    WORKER_INIT_FAILED: 'WORKER_INIT_FAILED',
    /** @deprecated 文字列検査は廃止した。コード生成は Worker 内の封鎖が実行時に止める。 */
    SECURITY_PATTERN_DETECTED: 'SECURITY_PATTERN_DETECTED',
    /** mod (SDK) と Host のプロトコルバージョンが非互換、または機能欠落の恐れがある */
    PROTOCOL_VERSION_MISMATCH: 'PROTOCOL_VERSION_MISMATCH',

    // ── resource / perf (Host 内部の診断用) ──
    /** 実行時間・キュー長などのリソース制限を超過した */
    RESOURCE_LIMIT_EXCEEDED: 'RESOURCE_LIMIT_EXCEEDED',
    /** Tick のコマンド処理時間がフレーム予算を超過した */
    PERF_TICK_BUDGET_EXCEEDED: 'PERF_TICK_BUDGET_EXCEEDED',
    /** アクティブ Worker 数が上限に達した */
    PERF_WORKER_LIMIT_REACHED: 'PERF_WORKER_LIMIT_REACHED',
} as const;

export type UbiErrorCode = (typeof UbiErrorCode)[keyof typeof UbiErrorCode];

/**
 * code を持つ Error。Worker / Host のどちらでも throw / instanceof できる。
 * `detail` には allowedDomains など code 固有の付帯情報を入れる。
 */
export class UbiError extends Error {
    readonly code: UbiErrorCode;
    readonly detail?: Record<string, unknown>;

    constructor(code: UbiErrorCode, message: string, detail?: Record<string, unknown>) {
        super(message);
        this.name = 'UbiError';
        this.code = code;
        this.detail = detail;
    }
}
