/**
 * Host (main thread) 側の型定義。
 *
 * - HostHandlers          : Worker からのコマンドを受ける Host 側コールバック群
 * - PluginWorkerInfo      : PluginRegistry が保持する 1 Worker のメタ情報
 * - PluginHostManagerOptions : PluginHostManager の生成オプション
 */
import type {
    CanvasCursorData,
    CanvasStrokeData,
    CmdGrip,
    ComponentInstance,
    EntityPatchPayload,
    FetchOptions,
    FetchResult,
    PluginGuestCommand,
    PluginHostEvent,
    PluginWorkerMessage,
    VNode,
} from '@ubichill/shared';
import type { TickMetric } from './pluginDiagnostics';

export type { FetchOptions, FetchResult } from '@ubichill/shared';

/** emit のルーティング scope。PluginRegistry.routeEmit と HostHandlers.onEventEmit で共有。 */
export type EmitScope = 'siblings' | 'parent' | 'children' | 'subtree' | 'world';

export type HostHandlers<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    onGetEntity?: (id: string) => ComponentInstance | undefined;
    onQueryEntities?: (entityType: string) => ComponentInstance[];
    onCreateEntity?: (entity: Omit<ComponentInstance, 'id'>) => Promise<ComponentInstance>;
    onUpdateEntity?: (id: string, patch: EntityPatchPayload) => Promise<void>;
    onDestroyEntity?: (id: string) => Promise<void>;
    onFetch?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    onMessage?: (msg: PluginWorkerMessage<TPayloadMap>) => void;
    onReady?: () => void;
    /** Worker の初期化が失敗したとき (構文エラー等) に発火。Host はローディングを終了する */
    onInitFailed?: (error: string) => void;
    onNetworkBroadcast?: (type: string, data: unknown) => void;
    onEventEmit?: (
        type: string,
        data: unknown,
        scope: EmitScope,
        targetType: string | undefined,
        senderComponentInstanceId: string | undefined,
    ) => void;
    onCommand?: (command: PluginGuestCommand) => void;
    /** Worker 起動時に Ubi.state から導出した Inspector 用スキーマを報告する */
    onEditorSchema?: (componentType: string, schema: Record<string, unknown>) => void;
    /**
     * Worker が Ubi.ui.render() を呼ぶたびに発火する。
     * vnode が null の場合はアンマウント（Ubi.ui.unmount()）。
     * VNodeRenderer で実 DOM に変換して描画する。
     */
    onRender?: (targetId: string, vnode: VNode | null) => void;
    /** Worker が Ubi.canvas.frame() を呼んだときに発火する（毎フレーム） */
    onCanvasFrame?: (targetId: string, activeStroke: CanvasStrokeData | null, cursors: CanvasCursorData[]) => void;
    /** Worker が Ubi.grip の hold/release/setHover を呼んだときに発火する */
    onGripCommand?: (payload: CmdGrip['payload']) => void;
    /** Worker が Ubi.canvas.commitStroke() を呼んだときに発火する */
    onCanvasCommitStroke?: (targetId: string, stroke: CanvasStrokeData) => void;
    /** Worker が Ubi.media.load() を呼んだときに発火する */
    onMediaLoad?: (targetId: string, url: string, mediaType?: 'hls' | 'video' | 'auto') => void;
    /** Worker が Ubi.media.play() を呼んだときに発火する */
    onMediaPlay?: (targetId: string) => void;
    /** Worker が Ubi.media.pause() を呼んだときに発火する */
    onMediaPause?: (targetId: string) => void;
    /** Worker が Ubi.media.seek() を呼んだときに発火する */
    onMediaSeek?: (targetId: string, time: number) => void;
    /** Worker が Ubi.media.setVolume() を呼んだときに発火する */
    onMediaSetVolume?: (targetId: string, volume: number) => void;
    /** Worker が Ubi.media.destroy() を呼んだときに発火する */
    onMediaDestroy?: (targetId: string) => void;
    /** Worker が Ubi.media.setVisible() を呼んだときに発火する */
    onMediaSetVisible?: (targetId: string, visible: boolean) => void;
    /**
     * Worker が Ubi.log() を呼んだときに発火する。
     * デフォルト実装は PluginHostManager が console[level] で出力する。
     * オーバーライドして UI パネルに表示することも可能。
     */
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, pluginId?: string) => void;
    /**
     * Tick 送信直前に発火するパフォーマンスフック（setMetricHandler が登録済みの場合のみ）。
     * deltaMs: rAF の実フレーム間隔。commandProcessingMs: 前Tickのホスト側コマンド処理累積時間。
     */
    onTickComplete?: (metric: TickMetric) => void;
};

/**
 * PluginRegistry に記録される 1 Worker のメタ情報。
 */
export interface PluginWorkerInfo {
    readonly pluginId: string;
    readonly componentInstanceId: string | undefined;
    readonly entityId: string | undefined;
    readonly parentEntityId: string | undefined;
    readonly componentType: string | undefined;
    readonly startedAt: number;
    /** @internal クロス Worker emit のための直接送信ハンドル。 */
    readonly _sendEvent: (event: PluginHostEvent) => void;
}

export interface PluginHostManagerOptions<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> {
    pluginCode: string;
    worldId?: string;
    myUserId?: string;
    pluginId?: string;
    /** Worker (= 1 Component インスタンス) を識別する flat ID。`Ubi.componentInstanceId` として参照可能。 */
    componentInstanceId?: string;
    /** 自 Worker が乗っている Entity (GameObject) の id。`Ubi.entityId` として参照可能。 */
    entityId?: string;
    /** 自 Entity の親 Entity の id。emit ルーティング (parent / subtree) で使用。 */
    parentEntityId?: string;
    /** この Worker が担当する Component 型 (`pluginId:componentName`)。 */
    componentType?: string;
    /** プラグインアセットのベースURL（Worker で Ubi.pluginBase として参照可能） */
    pluginBase?: string;
    /** この Component が監視する他 Component 型一覧（plugin.json の watchEntityTypes）。SDK の state 自動同期に使用 */
    watchEntityTypes?: string[];
    /** Worker 起動時点で watchEntityTypes にマッチしている既存エンティティ。SDK がプラグインコード実行前に state.local へ同期反映する */
    initialEntities?: ComponentInstance[];
    handlers: HostHandlers<TPayloadMap>;
    capabilities?: string[];
    maxExecutionTime?: number;
    onResourceLimitExceeded?: (reason: string) => void;
    tickFps?: number;
    disableAutoTick?: boolean;
    /** DOM 入力（マウス・キーボード）の自動収集を無効化する（デフォルト: false = 有効） */
    disableAutoInput?: boolean;
}
