/**
 * プラグインが Host (PluginRegistry) に渡す定義オブジェクト（Custom Elements ベース）。
 *
 * React コンポーネントではなく Custom Elements タグ名で宣言する。
 * Host は elementTag / singletonTag で CE を生成し、コンテキストを注入する。
 */
export interface WidgetDefinition {
    /** プラグイン識別子（plugin.json の id と一致） */
    id: string;
    /** 表示名 */
    name: string;
    /** エンティティごとに描画される Custom Elements タグ名 */
    elementTag: string;
    /**
     * ワールド参加中に 1 つだけ描画される Custom Elements タグ名（オプション）。
     * 複数のシングルトンタグが必要な場合は singletonTags を使う。
     */
    singletonTag?: string;
    /** 複数のシングルトンタグを登録する場合（singletonTag との排他） */
    singletonTags?: string[];
    /**
     * このプラグインの Custom Elements を customElements.define する関数。
     * PluginRegistry がプラグインロード後に一度だけ呼び出す。
     */
    register: () => void;
}

/**
 * Worker のみで動作するゼロトラストプラグインの定義。
 *
 * Custom Elements / React コンポーネントを一切持たず、
 * 描画はすべて Worker 内の ECS System が担う（OffscreenCanvas / VNode）。
 * Host は GenericPluginHost でサンドボックス・通信のみを提供する。
 */
export interface WorkerPluginDefinition {
    /** プラグイン識別子（plugin.json の id と一致） */
    id: string;
    /** 表示名 */
    name: string;
    /** esbuild でバンドルされた Worker 実行コード文字列 */
    workerCode: string;
    /** plugin.json の capabilities（未指定: 全許可） */
    capabilities?: string[];
    /**
     * Host が生成して Worker へ Transferable 転送する OffscreenCanvas のターゲット名リスト。
     * Worker は `Ubi.canvas.request(targetId)` で受け取る。
     */
    canvasTargets?: string[];
    /**
     * Worker が購読するエンティティタイプのリスト。
     * 一致するエンティティが更新されると EVT_ENTITY_WATCH として Worker へ転送される。
     * Worker では `event.type === 'entity:<type>'` として受け取る。
     */
    watchEntityTypes?: string[];
    /**
     * Host が生成して Worker が操作する <video> 要素のターゲット名リスト。
     * Worker は `Ubi.media.load(url, targetId)` で再生を指示する。
     * 受け取れるイベント: media:timeUpdate / media:ended / media:error / media:loaded
     */
    mediaTargets?: string[];
    /**
     * Ubi.network.fetch() で許可する追加ドメインのリスト。
     * デフォルトの PRODUCTION_ALLOWED_DOMAINS に追記される形で適用される。
     * 例: ["api.example.com", "cdn.example.com"]
     */
    fetchDomains?: string[];
    /**
     * プラグインアセットのベースURL（Worker で Ubi.pluginBase として参照可能）。
     * PluginRegistryContext が plugin.json のバージョンから自動計算して設定する。
     */
    pluginBase?: string;
    /**
     * true の場合、エンティティごとではなくワールド参加中に 1 つだけ起動される。
     * Host は EVT_PLAYER_JOINED / EVT_PLAYER_LEFT / EVT_PLAYER_CURSOR_MOVED を
     * Worker へ配信するため、プレゼンス情報を利用できる。
     * Worker は Ubi.network.sendToHost() で位置・ステータス更新を Host へ送れる。
     */
    singleton?: boolean;
}

/** 型ガード: WorkerPluginDefinition かどうか判定する */
export function isWorkerPlugin(def: WidgetDefinition | WorkerPluginDefinition): def is WorkerPluginDefinition {
    return 'workerCode' in def;
}
