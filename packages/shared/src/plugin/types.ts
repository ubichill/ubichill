// These types are imported from their source files to avoid circular dependency with index.ts
import type { AppAvatarDef, CursorPosition, EntityPatchPayload, User, WorldEntity } from '../index';

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
 * Ubi.avatar.set(appDef)
 * Fire & Forget: 自ユーザーのアバター（カーソル）設定を更新します。
 */
export type CmdAvatarSet = {
    type: 'AVATAR_SET';
    payload: { appDef: AppAvatarDef };
};

/**
 * Ubi.network.fetch(url, options) → Response
 * ホワイトリストされたURLに対してHTTPリクエストを送信します。
 * セキュリティのため、ホスト側でURL検証を行います。
 */
export type CmdNetFetch = {
    type: 'NET_FETCH';
    payload: {
        url: string;
        options?: {
            method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
            headers?: Record<string, string>;
            body?: string;
        };
    };
    id: string; // RPC
};

/** Guest → Host コマンドのユニオン型 */
export type PluginGuestCommand =
    | CmdReady
    | CmdSceneGetEntity
    | CmdSceneCreateEntity
    | CmdSceneUpdateEntity
    | CmdSceneDestroyEntity
    | CmdSceneSubscribeEntity
    | CmdSceneUnsubscribeEntity
    | CmdNetworkSendToHost
    | CmdNetworkBroadcast
    | CmdUiShowToast
    | CmdAvatarSet
    | CmdNetFetch;

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
 * 初期化後は Ubi.worldId / Ubi.myUserId / Ubi.pluginId で参照可能。
 *
 * @param worldId   所属ワールドのID
 * @param myUserId  自分のユーザーID
 * @param code      実行するプラグインコード (Sandbox内部のみ)
 */
export type EvtLifecycleInit = {
    type: 'EVT_LIFECYCLE_INIT';
    payload: { worldId: string; myUserId: string; code: string; pluginId?: string };
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
 * 現在は avatar:lock の送信にのみ使用。
 */
export type EvtCustom = {
    type: 'EVT_CUSTOM';
    payload: { eventType: string; data: unknown };
};

/**
 * [Network] 他ユーザーの Worker が Ubi.network.broadcast() で送ったデータ。
 * ECS System の events に { type: broadcastType, payload: { userId, data } } として届く。
 */
export type EvtNetworkBroadcast = {
    type: 'EVT_NETWORK_BROADCAST';
    payload: { userId: string; type: string; data: unknown };
};

// ============================================
// §2.1 入力イベント (Host が毎フレーム全 Worker へ配信)
// ============================================

/** マウス移動データ */
export type InputMouseMoveData = { x: number; y: number; buttons: number };
/** マウスボタン押下データ */
export type InputMouseDownData = { x: number; y: number; button: number };
/** マウスボタン解放データ */
export type InputMouseUpData = { x: number; y: number; button: number };
/** キーボード押下データ */
export type InputKeyDownData = { key: string; code: string };
/** キーボード解放データ */
export type InputKeyUpData = { key: string; code: string };

/** 1フレーム内の入力イベント1件 */
export type InputFrameEvent =
    | { type: 'MOUSE_MOVE'; data: InputMouseMoveData }
    | { type: 'MOUSE_DOWN'; data: InputMouseDownData }
    | { type: 'MOUSE_UP'; data: InputMouseUpData }
    | { type: 'KEY_DOWN'; data: InputKeyDownData }
    | { type: 'KEY_UP'; data: InputKeyUpData };

/**
 * [Input] Tick 直前に Host がすべての Worker へ配信する入力スナップショット。
 * プラグイン開発者は ECS System の `events` 引数から `EcsEventType.INPUT_*` で取得できる。
 */
export type EvtInput = {
    type: 'EVT_INPUT';
    payload: { events: InputFrameEvent[] };
};

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
    | EvtNetworkBroadcast
    | EvtInput;

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

/** NET_FETCH の戻り値 */
export type RpcNetFetchResult = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
};
