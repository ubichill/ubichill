// These types are imported from their source files to avoid circular dependency with index.ts
import type { AppAvatarDef, CursorPosition, EntityPatchPayload, User, WorldEntity } from '../index';
import type { VNode } from './vnode';

/**
 * ペイロードマップから判別可能ユニオン型（Discriminated Union）を生成する。
 *
 * - **送信側**: `sendToHost<TMap>('TYPE', data)` — K が推論され payload が型安全に制約される
 * - **受信側**: `onMessage(msg: PluginWorkerMessage<TMap>)` — `msg.type` で switch すると payload が自動で絞り込まれる
 *
 * @example
 * ```ts
 * type PenPayloads = {
 *     DRAWING_UPDATE: { points: Array<[number, number, number]> };
 *     STROKE_COMPLETE: { points: Array<[number, number, number]> };
 * };
 * // 送信
 * Ubi.network.sendToHost<PenPayloads>('DRAWING_UPDATE', { points: [...] });
 * // 受信（判別可能ユニオン）
 * type PenMsg = PluginWorkerMessage<PenPayloads>;
 * ```
 */
export type PluginWorkerMessage<TPayloadMap extends Record<string, unknown> = Record<string, unknown>> = {
    [K in keyof TPayloadMap & string]: { type: K; payload: TPayloadMap[K] };
}[keyof TPayloadMap & string];
// TODO: Ideally, we should move the base types out of index.ts into, e.g., 'schemas' or 'types.ts' in shared root.

// ============================================
// Ubichill Plugin Protocol v2
//
// 【設計原則】
//  - Plugin (Worker) は UI を持たない。描画はすべて Host (React) が担う。
//  - データのやり取りはシリアライズ可能な純粋なオブジェクトのみ。
//  - API は「状態の宣言」ベース。DOM操作のような命令的APIは禁止。
//  - 将来の Wasm/SharedArrayBuffer 移行を見越してデータ設計する。
// ============================================

// ============================================
// §1. Guest → Host: コマンド (RPC)
//
// 命名規則: <NAMESPACE>_<VERB>
//   - 戻り値あり (RPC): id フィールドに一意なリクエストIDを付与
//   - 戻り値なし (Fire & Forget): id フィールドなし
// ============================================

/**
 * Ubi.world.getEntity(id) → WorldEntity | null
 * 指定IDのエンティティを取得します。
 */
export type CmdSceneGetEntity = {
    type: 'SCENE_GET_ENTITY';
    payload: { id: string };
    id: string; // RPC
};

/**
 * Ubi.world.createEntity(entity) → string (作成されたエンティティのID)
 * 新しいエンティティをワールドに作成します。
 */
export type CmdSceneCreateEntity = {
    type: 'SCENE_CREATE_ENTITY';
    payload: { entity: Omit<WorldEntity, 'id'> };
    id: string; // RPC
};

/**
 * Ubi.world.updateEntity(id, patch) → void
 * エンティティの状態を宣言的に更新します。
 * ※ DOM操作ではなく「状態の宣言」として設計
 */
export type CmdSceneUpdateEntity = {
    type: 'SCENE_UPDATE_ENTITY';
    payload: { id: string; patch: EntityPatchPayload };
    id: string; // RPC
};

/**
 * Ubi.world.destroyEntity(id) → void
 * エンティティを削除します。
 */
export type CmdSceneDestroyEntity = {
    type: 'SCENE_DESTROY_ENTITY';
    payload: { id: string };
    id: string; // RPC
};

/**
 * Ubi.world.subscribeEntity(id) → (購読開始、以降 EVT_SCENE_ENTITY_UPDATED が届く)
 * Fire & Forget: エンティティ更新の購読を開始します。
 */
export type CmdSceneSubscribeEntity = {
    type: 'SCENE_SUBSCRIBE_ENTITY';
    payload: { id: string };
};

/**
 * Ubi.world.unsubscribeEntity(id)
 * Fire & Forget: エンティティ更新の購読を解除します。
 */
export type CmdSceneUnsubscribeEntity = {
    type: 'SCENE_UNSUBSCRIBE_ENTITY';
    payload: { id: string };
};

/**
 * Worker が初期化完了したことを Host に通知します。
 * Host はこれを受信してイベントキューのフラッシュを行います。
 * Fire & Forget (id なし)
 */
export type CmdReady = {
    type: 'CMD_READY';
};

/**
 * Ubi.log(message, level?)
 * Fire & Forget: プラグイン Worker からホストへログを転送する。
 * capability 宣言不要（常に許可）。
 */
export type CmdLog = {
    type: 'CMD_LOG';
    payload: { level: 'debug' | 'info' | 'warn' | 'error'; message: string };
};

/**
 * Ubi.network.sendToHost(type, data)
 * Fire & Forget: 自分の Host (React) にだけメッセージを送ります。
 * 他のユーザーには届きません。onMessage ハンドラで受け取ります。
 */
export type CmdNetworkSendToHost = {
    type: 'NETWORK_SEND_TO_HOST';
    payload: { type: string; data: unknown };
};

/**
 * Ubi.network.broadcast(type, data)
 * Fire & Forget: ワールド内の全ユーザーに揮発性データを送ります。
 * DB には保存されません。他ユーザーの Worker に ECS イベントとして届きます。
 * capability: 'net:broadcast' が必要です。
 */
export type CmdNetworkBroadcast = {
    type: 'NETWORK_BROADCAST';
    payload: { type: string; data: unknown };
};

/**
 * Ubi.ui.showToast(text)
 * Fire & Forget: 画面にトースト通知を表示します。
 */
export type CmdUiShowToast = {
    type: 'UI_SHOW_TOAST';
    payload: { text: string };
};

/**
 * Ubi.ui.render(factory, targetId?)
 * Fire & Forget: Worker が描画したい VNode ツリーを Host に送る。
 * Host は VNodeRenderer で実 DOM に変換して Shadow DOM に注入する。
 * vnode が null の場合はアンマウント。
 */
export type CmdUiRender = {
    type: 'UI_RENDER';
    payload: { targetId: string; vnode: VNode | null };
};

/**
 * Ubi.avatar.set(appDef)
 * Fire & Forget: 自ユーザーのアバター（カーソル）設定を更新します。
 */
export type CmdAvatarSet = {
    type: 'AVATAR_SET';
    payload: { appDef: AppAvatarDef };
};

/** Ubi.network.fetch() / onFetch ハンドラー共通のリクエストオプション */
export type FetchOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: string;
};

/** Ubi.network.fetch() / onFetch ハンドラー共通のレスポンス型 */
export type FetchResult = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
};

/**
 * Ubi.network.fetch(url, options) → Response
 * ホワイトリストされたURLに対してHTTPリクエストを送信します。
 * セキュリティのため、ホスト側でURL検証を行います。
 */
export type CmdNetFetch = {
    type: 'NET_FETCH';
    payload: { url: string; options?: FetchOptions };
    id: string; // RPC
};

/**
 * Ubi.world.queryEntities(type) → WorldEntity[]
 * 指定タイプのエンティティを一括取得します。
 */
export type CmdSceneQueryEntities = {
    type: 'SCENE_QUERY_ENTITIES';
    payload: { entityType: string };
    id: string; // RPC
};

/**
 * Canvas に描画するストロークデータ。
 * points: [x, y, pressure] の配列。
 */
export type CanvasStrokeData = {
    points: Array<[number, number, number]>;
    color: string;
    size: number;
};

/** shape === 'custom' 時の塗りつぶしパス定義 */
export type CanvasCursorPathFill = { d: string; fill: string };
/** shape === 'custom' 時の輪郭パス定義 */
export type CanvasCursorPathStroke = { d: string; stroke: string; lineWidth: number };

/**
 * Canvas に描画するカーソルデータ。
 *
 * shape === 'custom' の場合、プラグインが pathFills / pathStrokes に
 * SVG path d 属性文字列でカーソル形状を定義する。
 * 座標原点はカーソル先端。rotation で回転を指定できる。
 */
export type CanvasCursorData = {
    x: number;
    y: number;
    color: string;
    size: number;
    /** カーソル形状。'custom' はプラグイン定義パス、省略時は円形 */
    shape?: 'circle' | 'custom';
    /** shape === 'custom' 時の回転角（ラジアン） */
    rotation?: number;
    /** shape === 'custom' 時の塗りつぶしパス群（座標原点 = カーソル先端） */
    pathFills?: CanvasCursorPathFill[];
    /** shape === 'custom' 時の輪郭パス群 */
    pathStrokes?: CanvasCursorPathStroke[];
};

/**
 * Ubi.canvas.frame(targetId, { activeStroke, cursor })
 * Fire & Forget: ホストに毎フレームのキャンバス描画状態を送信する。
 * ホスト側で永続レイヤー + アクティブストローク + カーソルを合成して描画する。
 */
export type CmdCanvasFrame = {
    type: 'CANVAS_FRAME';
    payload: {
        targetId: string;
        activeStroke: CanvasStrokeData | null;
        cursor: CanvasCursorData | null;
    };
};

/**
 * Ubi.canvas.commitStroke(targetId, stroke)
 * Fire & Forget: 完成ストロークをホストの永続レイヤーへコミットする。
 */
export type CmdCanvasCommitStroke = {
    type: 'CANVAS_COMMIT_STROKE';
    payload: {
        targetId: string;
        stroke: CanvasStrokeData;
    };
};

// ─── Media Commands (Guest → Host) ──────────────────────────────────────────

/**
 * Ubi.media.load(url, targetId?, mediaType?)
 * Fire & Forget: Host に指定 URL のメディアを読み込ませる。
 * mediaType が 'hls' の場合 Hls.js を使用。'auto' は URL から自動判定。
 * capability: 'video:control' が必要。
 */
export type CmdMediaLoad = {
    type: 'MEDIA_LOAD';
    payload: { targetId: string; url: string; mediaType?: 'hls' | 'video' | 'auto' };
};

/** Ubi.media.play(targetId?) — 再生開始 */
export type CmdMediaPlay = { type: 'MEDIA_PLAY'; payload: { targetId: string } };

/** Ubi.media.pause(targetId?) — 一時停止 */
export type CmdMediaPause = { type: 'MEDIA_PAUSE'; payload: { targetId: string } };

/** Ubi.media.seek(time, targetId?) — 再生位置を指定秒へ移動 */
export type CmdMediaSeek = { type: 'MEDIA_SEEK'; payload: { targetId: string; time: number } };

/** Ubi.media.setVolume(volume, targetId?) — 音量設定 (0–1) */
export type CmdMediaSetVolume = { type: 'MEDIA_SET_VOLUME'; payload: { targetId: string; volume: number } };

/** Ubi.media.destroy(targetId?) — メディア要素を解放 */
export type CmdMediaDestroy = { type: 'MEDIA_DESTROY'; payload: { targetId: string } };

/** Ubi.media.setVisible(visible, targetId?) — video 要素の表示/非表示 */
export type CmdMediaSetVisible = { type: 'MEDIA_SET_VISIBLE'; payload: { targetId: string; visible: boolean } };

/** Guest → Host コマンドのユニオン型 */
export type PluginGuestCommand =
    | CmdReady
    | CmdLog
    | CmdSceneGetEntity
    | CmdSceneCreateEntity
    | CmdSceneUpdateEntity
    | CmdSceneDestroyEntity
    | CmdSceneSubscribeEntity
    | CmdSceneUnsubscribeEntity
    | CmdSceneQueryEntities
    | CmdCanvasFrame
    | CmdCanvasCommitStroke
    | CmdNetworkSendToHost
    | CmdNetworkBroadcast
    | CmdUiShowToast
    | CmdUiRender
    | CmdAvatarSet
    | CmdNetFetch
    | CmdMediaLoad
    | CmdMediaPlay
    | CmdMediaPause
    | CmdMediaSeek
    | CmdMediaSetVolume
    | CmdMediaDestroy
    | CmdMediaSetVisible;

/** 後方互換エイリアス */
export type PluginCommand = PluginGuestCommand;

// ============================================
// §2. Host → Guest: イベント
//
// 命名規則: EVT_<NAMESPACE>_<EVENT_NAME>
//
// VRChat Udon の「Player Events」に相当。
// プラグイン開発者はこれらをリスナー登録して処理します。
// ============================================

/**
 * [Lifecycle] プラグインの初期化完了時に Worker へ送られるイベント。
 * 初期化後は Ubi.worldId / Ubi.myUserId / Ubi.pluginId / Ubi.entityId で参照可能。
 *
 * @param worldId   所属ワールドのID
 * @param myUserId  自分のユーザーID
 * @param code      実行するプラグインコード (Sandbox内部のみ)
 * @param entityId  このプラグイン Worker を起動したエンティティの ID（オプション）
 */
export type EvtLifecycleInit = {
    type: 'EVT_LIFECYCLE_INIT';
    payload: { worldId: string; myUserId: string; code: string; pluginId?: string; entityId?: string };
};

/**
 * [Lifecycle] 毎フレーム (requestAnimationFrame相当) に Worker へ送られるイベント。
 * Ubi.registerSystem(fn) で登録した System が deltaTime を受け取る。
 *
 * @param deltaTime  前フレームからの経過時間 (ms)
 */
export type EvtLifecycleTick = {
    type: 'EVT_LIFECYCLE_TICK';
    payload: { deltaTime: number };
};

/**
 * [Player] ユーザーが入室したとき。
 * ECS System の events に EcsEventType.PLAYER_JOINED として届く。
 *
 * @param user  入室したユーザーの情報
 */
export type EvtPlayerJoined = {
    type: 'EVT_PLAYER_JOINED';
    payload: { user: User };
};

/**
 * [Player] ユーザーが退室したとき。
 * ECS System の events に EcsEventType.PLAYER_LEFT として届く。
 *
 * @param userId  退室したユーザーのID
 */
export type EvtPlayerLeft = {
    type: 'EVT_PLAYER_LEFT';
    payload: { userId: string };
};

/**
 * [Player] ユーザーのカーソルが移動したとき。
 * ECS System の events に EcsEventType.PLAYER_CURSOR_MOVED として届く。
 *
 * @param userId    移動したユーザーのID
 * @param position  新しいカーソル位置 {x, y}
 */
export type EvtPlayerCursorMoved = {
    type: 'EVT_PLAYER_CURSOR_MOVED';
    payload: { userId: string; position: CursorPosition };
};

/**
 * [Scene] 購読中のエンティティが更新されたとき。
 * ECS System の events に EcsEventType.ENTITY_UPDATED として届く。
 * ※ Ubi.world.subscribeEntity() で購読したエンティティのみ届く
 *
 * @param entity  更新後のエンティティの完全なスナップショット
 */
export type EvtSceneEntityUpdated = {
    type: 'EVT_SCENE_ENTITY_UPDATED';
    payload: { entity: WorldEntity };
};

/**
 * [RPC] コマンドへのレスポンス (内部用)
 * プラグイン開発者が直接扱うことはありません。
 * Promise のresolve/rejectに自動的に変換されます。
 */
export type EvtRpcResponse = {
    type: 'EVT_RPC_RESPONSE';
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
};

/**
 * [Custom] Host から Worker へ任意のイベントを送る低レベル脱出口。
 * ECS System の events に { type: eventType, payload: data } として届く。
 *
 * @deprecated 通常は sendToHost / network.broadcast の逆方向通信として使わない。
 * Host → Worker の型安全な通信 API が整備されるまでの暫定手段。
 * 現在は avatar:lock の送信にのみ使用。watchEntityTypes には EVT_ENTITY_WATCH を使うこと。
 */
export type EvtCustom = {
    type: 'EVT_CUSTOM';
    payload: { eventType: string; data: unknown };
};

/**
 * [Scene] watchEntityTypes で監視中のエンティティが作成・更新されたとき。
 * ECS System の events に { type: 'entity:<entityType>', payload: entity } として届く。
 *
 * GenericPluginHost が WorkerPluginDefinition.watchEntityTypes と照合し自動送信する。
 * EVT_CUSTOM に代わる型安全な watchEntityTypes 専用イベント。
 */
export type EvtEntityWatch = {
    type: 'EVT_ENTITY_WATCH';
    payload: {
        entityType: string;
        entity: WorldEntity;
    };
};

/**
 * [Network] 他ユーザーの Worker が Ubi.network.broadcast() で送ったデータ。
 * ECS System の events に { type: broadcastType, payload: { userId, data } } として届く。
 */
export type EvtNetworkBroadcast = {
    type: 'EVT_NETWORK_BROADCAST';
    payload: { userId: string; type: string; data: unknown };
};

/**
 * [UI] レンダリングされた UI 要素をユーザーが操作したとき（onUbi* ハンドラー起動）。
 * Host から Worker へ送られ、UbiSDK が jsx-runtime の _callHandler(index) を呼ぶ。
 */
export type EvtUiAction = {
    type: 'EVT_UI_ACTION';
    payload: {
        /** UI_RENDER 時に指定した targetId */
        targetId: string;
        /** jsx-runtime が '__h{n}' として埋め込んだインデックス */
        handlerIndex: number;
        /** DOM イベント名（'click', 'input' 等） */
        eventType: string;
        /** イベント詳細（CustomEvent.detail 相当）*/
        detail?: unknown;
    };
};

// ============================================
// §2.1 入力イベント (Host が毎フレーム全 Worker へ配信)
// ============================================

/**
 * マウス移動データ。
 * x/y はワールド座標（clientX + scrollLeft）。
 * viewportX/viewportY はビューポート座標（clientX/clientY）。
 */
export type InputMouseMoveData = {
    x: number;
    y: number;
    viewportX: number;
    viewportY: number;
    buttons: number;
    /** DOM の computed cursor スタイル（'pointer' / 'text' / 'default' 等） */
    cursorStyle?: string;
};
/**
 * マウスボタン押下データ。
 * x/y はワールド座標、viewportX/viewportY はビューポート座標。
 */
export type InputMouseDownData = { x: number; y: number; viewportX: number; viewportY: number; button: number };
/**
 * マウスボタン解放データ。
 * x/y はワールド座標、viewportX/viewportY はビューポート座標。
 */
export type InputMouseUpData = { x: number; y: number; viewportX: number; viewportY: number; button: number };
/** キーボード押下データ */
export type InputKeyDownData = { key: string; code: string };
/** キーボード解放データ */
export type InputKeyUpData = { key: string; code: string };
/**
 * コンテキストメニュー（右クリック）データ。
 * x/y はワールド座標（clientX + scrollLeft）。
 * viewportX/viewportY はビューポート座標（clientX/clientY）。
 */
export type InputContextMenuData = { x: number; y: number; viewportX: number; viewportY: number };
/**
 * スクロールデータ。
 * x/y はスクロール量（scrollLeft/scrollTop）。
 */
export type InputScrollData = { x: number; y: number };
/** ウィンドウリサイズデータ */
export type InputResizeData = { width: number; height: number };

/** 1フレーム内の入力イベント1件 */
export type InputFrameEvent =
    | { type: 'MOUSE_MOVE'; data: InputMouseMoveData }
    | { type: 'MOUSE_DOWN'; data: InputMouseDownData }
    | { type: 'MOUSE_UP'; data: InputMouseUpData }
    | { type: 'KEY_DOWN'; data: InputKeyDownData }
    | { type: 'KEY_UP'; data: InputKeyUpData }
    | { type: 'CONTEXT_MENU'; data: InputContextMenuData }
    | { type: 'SCROLL'; data: InputScrollData }
    | { type: 'RESIZE'; data: InputResizeData };

/**
 * [Input] Tick 直前に Host がすべての Worker へ配信する入力スナップショット。
 * プラグイン開発者は ECS System の `events` 引数から `EcsEventType.INPUT_*` で取得できる。
 */
export type EvtInput = {
    type: 'EVT_INPUT';
    payload: { events: InputFrameEvent[] };
};

// ─── Media Events (Host → Guest) ────────────────────────────────────────────

/** 再生位置の定期通知 */
export type EvtMediaTimeUpdate = {
    type: 'EVT_MEDIA_TIME_UPDATE';
    payload: { targetId: string; currentTime: number; duration: number };
};

/** 再生終了通知 */
export type EvtMediaEnded = { type: 'EVT_MEDIA_ENDED'; payload: { targetId: string } };

/** メディアエラー通知 */
export type EvtMediaError = { type: 'EVT_MEDIA_ERROR'; payload: { targetId: string; message: string } };

/** メタデータ読み込み完了通知 (duration が確定) */
export type EvtMediaLoaded = { type: 'EVT_MEDIA_LOADED'; payload: { targetId: string; duration: number } };

/** Host → Guest イベントのユニオン型 */
export type PluginHostEvent =
    | EvtLifecycleInit
    | EvtLifecycleTick
    | EvtPlayerJoined
    | EvtPlayerLeft
    | EvtPlayerCursorMoved
    | EvtSceneEntityUpdated
    | EvtRpcResponse
    | EvtCustom
    | EvtEntityWatch
    | EvtNetworkBroadcast
    | EvtInput
    | EvtUiAction
    | EvtMediaTimeUpdate
    | EvtMediaEnded
    | EvtMediaError
    | EvtMediaLoaded;

/** 後方互換エイリアス */
export type PluginEvent = PluginHostEvent;

// ============================================
// §3. コールバック型 (Ubi.Events へのリスナー引数)
//
// VRChat Udon の各 Player Event のシグネチャに相当。
// ============================================

/** onTick のコールバック。deltaTime は前フレームからの経過時間(ms) */
export type TickCallback = (deltaTime: number) => void;

/** onPlayerJoined のコールバック */
export type UserJoinedCallback = (user: User) => void;

/** onPlayerLeft のコールバック。userId のみ渡される */
export type UserLeftCallback = (userId: string) => void;

/** onPlayerCursorMoved のコールバック */
export type CursorMovedCallback = (userId: string, position: CursorPosition) => void;

/** onEntityUpdated のコールバック。更新後のエンティティスナップショットが渡される */
export type EntityUpdatedCallback = (entity: WorldEntity) => void;

/** onCustomEvent のコールバック */
export type CustomEventCallback = (eventType: string, data: unknown) => void;

// ============================================
// §4. RPC戻り値型
//
// 各コマンドが resolve する値の型をまとめる。
// Host 側の実装で参照する。
// ============================================

/** SCENE_GET_ENTITY の戻り値 */
export type RpcGetEntityResult = WorldEntity | null;

/** SCENE_CREATE_ENTITY の戻り値 */
export type RpcCreateEntityResult = string; // 作成されたエンティティのID

/** SCENE_UPDATE_ENTITY / SCENE_DESTROY_ENTITY の戻り値 */
/** SCENE_UPDATE_ENTITY / SCENE_DESTROY_ENTITY は void を返します */

/** NET_FETCH の戻り値（FetchResult の後方互換エイリアス） */
export type RpcNetFetchResult = FetchResult;
