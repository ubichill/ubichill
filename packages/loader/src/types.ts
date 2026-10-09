import type { ComponentDataFieldSpec, LockRejectReason, ModSignatureRejectReason, OverlayMode } from '@ubichill/shared';

/**
 * 取得・検証済みの mod（React/DOM 非依存の中立表現）。
 * Host 側（frontend）がこれを `WorkerModDefinition` にマップする。
 */
export interface LoadedMod {
    /** Component 型 `modId:componentName`。 */
    id: string;
    /** 表示名。 */
    name: string;
    /** バンドル済み Worker 実行コード（検証済みバイト列を decode したもの）。 */
    workerCode: string;
    /** 付与を許す capability（verified 時は lock 天井、それ以外は manifest 由来）。 */
    capabilities?: string[];
    /** 署名で確認できた作者アカウント（`handle@domain`）。無いのは「署名なし（開発）」として許した mod だけ。 */
    author?: string;
    /** versioned アセットベース URL（Worker で `Ubi.modBase`）。 */
    modBase: string;
    /** 同梱アセットの相対パス → SRI。manifest 由来（manifest は lock と照合済み）。 */
    assetIntegrity?: Readonly<Record<string, string>>;
    watchScope: 'entity' | 'subtree' | 'parent' | 'world';
    watchEntityTypes?: string[];
    canvasTargets?: string[];
    mediaTargets?: string[];
    singleton?: boolean;
    thumbnail?: string;
    /** 画面固定オーバーレイの既定値（角 / `'fill'`。`true` は `'top-left'`）。Component 追加時の初期値。 */
    overlay?: OverlayMode;
    /** Inspector 用の data フィールド宣言（entityRef 等）。Host が declaredTargets 算出に使う。 */
    dataFields?: Record<string, ComponentDataFieldSpec>;
}

/**
 * {@link acquireMod} の戻り値。
 *  - LoadedMod   : 取得＋検証成功。
 *  - 'data-only' : worker を持たない純データ Component（警告不要）。
 *  - 'not-found' : manifest/worker 取得失敗・未宣言。
 *  - { rejected }: lock の照合か作者署名の確認で拒否。理由付き。
 */
export type AcquireResult =
    | LoadedMod
    | 'data-only'
    | 'not-found'
    | { rejected: LockRejectReason | ModSignatureRejectReason };

/** DOM/Node 共通の最小 fetch シグネチャ（注入用）。 */
export type FetchLike = (input: string, init?: { cache?: 'no-store' }) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
    ok: boolean;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
