// These types are imported from their source files to avoid circular dependency with index.ts
import type { AppAvatarDef, CursorPosition, EntityPatchPayload, User, WorldEntity } from '../index';
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
 * Ubi.Scene.getEntity(id) → WorldEntity | null
 * 指定IDのエンティティを取得します。
 */
export type CmdSceneGetEntity = {
    type: 'SCENE_GET_ENTITY';
    payload: { id: string };
    id: string; // RPC
};

/**
 * Ubi.Scene.createEntity(entity) → string (作成されたエンティティのID)
 * 新しいエンティティをワールドに作成します。
 */
export type CmdSceneCreateEntity = {
    type: 'SCENE_CREATE_ENTITY';
    payload: { entity: Omit<WorldEntity, 'id'> };
    id: string; // RPC
};

/**
 * Ubi.Scene.updateEntity(id, patch) → void
 * エンティティの状態を宣言的に更新します。
 * ※ DOM操作ではなく「状態の宣言」として設計
 */
export type CmdSceneUpdateEntity = {
    type: 'SCENE_UPDATE_ENTITY';
    payload: { id: string; patch: EntityPatchPayload };
    id: string; // RPC
};

/**
 * Ubi.Scene.destroyEntity(id) → void
 * エンティティを削除します。
 */
export type CmdSceneDestroyEntity = {
    type: 'SCENE_DESTROY_ENTITY';
    payload: { id: string };
    id: string; // RPC
};

/**
 * Ubi.Scene.subscribeEntity(id) → (購読開始、以降 EVT_ENTITY_UPDATED が届く)
 * Fire & Forget: エンティティ更新の購読を開始します。
 */
export type CmdSceneSubscribeEntity = {
    type: 'SCENE_SUBSCRIBE_ENTITY';
    payload: { id: string };
};

/**
 * Ubi.Scene.unsubscribeEntity(id)
 * Fire & Forget: エンティティ更新の購読を解除します。
 */
export type CmdSceneUnsubscribeEntity = {
    type: 'SCENE_UNSUBSCRIBE_ENTITY';
    payload: { id: string };
};

/**
 * Ubi.Scene.updateCursorPosition(x, y)
 * Fire & Forget: このプラグインが制御するカーソルの位置を更新します。
 * ※ 毎フレーム呼ぶことを想定した高頻度コマンド
 */
export type CmdSceneUpdateCursor = {
    type: 'SCENE_UPDATE_CURSOR';
    payload: { x: number; y: number };
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
 * Ubi.messaging.send(type, data)
 * Fire & Forget: ホストに対して専用のカスタムメッセージを送信します。
 */
export type CmdCustomMessage = {
    type: 'CUSTOM_MESSAGE';
    payload: { type: string; data: unknown };
};

/**
 * Ubi.UI.showToast(text)
 * Fire & Forget: 画面にトースト通知を表示します。
 */
export type CmdUiShowToast = {
    type: 'UI_SHOW_TOAST';
    payload: { text: string };
};

/**
 * Ubi.Avatar.set(appDef)
 * Fire & Forget: 自ユーザーのアバター（カーソル）設定を更新します。
 */
export type CmdAvatarSet = {
    type: 'AVATAR_SET';
    payload: { appDef: AppAvatarDef };
};

/**
 * Ubi.Net.fetch(url, options) → Response
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
    | CmdSceneUpdateCursor
    | CmdCustomMessage
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
 * [Lifecycle] プラグインの初期化完了時
 * Ubi.Events.onInit((ctx) => { ... })
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
 * [Lifecycle] 毎フレーム (requestAnimationFrame相当)
 * Ubi.Events.onTick((deltaTime: number) => { ... })
 *
 * @param deltaTime  前フレームからの経過時間 (ms)
 */
export type EvtLifecycleTick = {
    type: 'EVT_LIFECYCLE_TICK';
    payload: { deltaTime: number };
};

/**
 * [Player] ユーザーが入室したとき
 * Ubi.Events.onPlayerJoined((player: User) => { ... })
 *
 * @param user  入室したユーザーの情報
 */
export type EvtPlayerJoined = {
    type: 'EVT_PLAYER_JOINED';
    payload: { user: User };
};

/**
 * [Player] ユーザーが退室したとき
 * Ubi.Events.onPlayerLeft((userId: string) => { ... })
 *
 * @param userId  退室したユーザーのID
 */
export type EvtPlayerLeft = {
    type: 'EVT_PLAYER_LEFT';
    payload: { userId: string };
};

/**
 * [Player] ユーザーのカーソルが移動したとき
 * Ubi.Events.onPlayerCursorMoved((userId, position) => { ... })
 *
 * @param userId    移動したユーザーのID
 * @param position  新しいカーソル位置 {x, y}
 */
export type EvtPlayerCursorMoved = {
    type: 'EVT_PLAYER_CURSOR_MOVED';
    payload: { userId: string; position: CursorPosition };
};

/**
 * [Scene] 購読中のエンティティが更新されたとき
 * Ubi.Events.onEntityUpdated((entity: WorldEntity) => { ... })
 *
 * ※ subscribeEntity() で購読したエンティティのみ届く
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
 * [Custom] プラグイン間・ホストからの汎用カスタムイベント
 * Ubi.Events.onCustomEvent((eventType, data) => { ... })
 */
export type EvtCustom = {
    type: 'EVT_CUSTOM';
    payload: { eventType: string; data: unknown };
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
    | EvtCustom;

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
