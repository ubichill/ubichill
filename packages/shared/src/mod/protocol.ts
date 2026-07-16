/**
 * Ubichill modプロトコルの「コマンド名 / イベント名」カタログ。
 *
 * mod/types.ts の discriminated union のリテラル (`type: 'SCENE_GET_ENTITY'`) と
 * 1:1 で対応する。型は union が discriminant として守るが、値を書く箇所
 * (SDK の送信 / Host の switch / InputCollector の生成) はこの const を参照することで、
 * 文字列の散在を防ぎ・一覧性とリネーム容易性を得る。
 *
 * カテゴリ:
 *   CommandType    — Guest(Worker) → Host の RPC / Fire&Forget コマンド
 *   HostEventType  — Host → Guest(Worker) のイベント
 *   InputEventType — EVT_INPUT.payload.events[].type の入力サブイベント
 */

/**
 * modプロトコル（Guest(SDK) ↔ Host(Sandbox) のメッセージ契約）のバージョン。
 *
 * SDK は独立配布されるため「古い SDK で作られた mod」と「新しい Host」が
 * 通信する状況が必ず起きる。両者は初期化時に互いのバージョンを名乗り、
 * {@link checkProtocolCompatibility} で不一致を検出して開発者に警告する。
 *
 * ## 進化ルール（後方互換の生命線）
 * - `CommandType` / `HostEventType` / `InputEventType` の値は **削除・改名しない**（追加のみ）。
 *   値は文字列なので並べ替えは安全。ペイロードのフィールドは **optional でのみ** 追加する。
 * - 上記を守る「加算的変更」のたびに {@link PROTOCOL_VERSION} を +1 する。
 * - やむを得ず互換を壊す変更をしたときだけ {@link MIN_COMPATIBLE_PROTOCOL_VERSION} を上げる。
 *
 * 加算的進化である限り、あるバージョン V の実装は V 以下のすべてを理解できる。
 * したがって危険なのは「mod (guest) が Host より新しい」ケースだけ（Host が未対応の
 * コマンドを mod が使う恐れがある）。逆（古い mod × 新しい Host）は常に動く。
 */
export const PROTOCOL_VERSION = 1;

/**
 * これ未満のバージョンで作られた mod とは互換性がない下限。
 *
 * 現時点で破壊的変更はまだ無いため 0 = 「未バージョン管理時代（version 未名乗り）の
 * 旧 mod も含めて全部互換」。将来やむなく互換を壊す変更を入れたときに、
 * PROTOCOL_VERSION と一緒にこの値も引き上げる（そのとき旧 mod が incompatible になる）。
 */
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 0;

export type ProtocolCompatibilityLevel =
    /** 完全互換。 */
    | 'ok'
    /** 通信は成立するが、mod が使う新機能を Host が持たない恐れ（Host が古い）。 */
    | 'degraded'
    /** 破壊的変更をまたいでおり通信不能。mod の再ビルドが必要。 */
    | 'incompatible';

export interface ProtocolCompatibility {
    level: ProtocolCompatibilityLevel;
    hostVersion: number;
    guestVersion: number;
    /** degraded / incompatible のときの人間向け説明。 */
    message?: string;
}

/**
 * Host と Guest(mod/SDK) のプロトコルバージョン整合性を判定する純関数。
 * Host 側・Guest 側どちらからでも同じ関数で評価できる（自分の版と相手の版を渡す）。
 *
 * @param hostVersion   Host(Sandbox) のプロトコルバージョン
 * @param guestVersion  Guest(mod/SDK) のプロトコルバージョン（未名乗り＝旧世代は 0 を渡す）
 */
export function checkProtocolCompatibility(hostVersion: number, guestVersion: number): ProtocolCompatibility {
    if (guestVersion < MIN_COMPATIBLE_PROTOCOL_VERSION) {
        return {
            level: 'incompatible',
            hostVersion,
            guestVersion,
            message: `この mod はプロトコル v${guestVersion} 用ですが、Host は v${MIN_COMPATIBLE_PROTOCOL_VERSION} 以上を要求します（破壊的変更あり）。mod を最新 SDK で再ビルドしてください。`,
        };
    }
    if (hostVersion < guestVersion) {
        return {
            level: 'degraded',
            hostVersion,
            guestVersion,
            message: `この mod はプロトコル v${guestVersion} 用で、Host は v${hostVersion} です。mod が使う新しい機能は動作しない可能性があります。Host（本体）の更新を推奨します。`,
        };
    }
    return { level: 'ok', hostVersion, guestVersion };
}

/** Guest (Worker) → Host コマンド。 */
export const CommandType = {
    // scene (ECS)
    SCENE_GET_ENTITY: 'SCENE_GET_ENTITY',
    SCENE_QUERY_ENTITIES: 'SCENE_QUERY_ENTITIES',
    SCENE_CREATE_ENTITY: 'SCENE_CREATE_ENTITY',
    SCENE_UPDATE_ENTITY: 'SCENE_UPDATE_ENTITY',
    SCENE_DESTROY_ENTITY: 'SCENE_DESTROY_ENTITY',
    SCENE_SUBSCRIBE_ENTITY: 'SCENE_SUBSCRIBE_ENTITY',
    SCENE_UNSUBSCRIBE_ENTITY: 'SCENE_UNSUBSCRIBE_ENTITY',
    // network
    NETWORK_FETCH: 'NETWORK_FETCH',
    NETWORK_BROADCAST: 'NETWORK_BROADCAST',
    NETWORK_SEND_TO_HOST: 'NETWORK_SEND_TO_HOST',
    EVENT_EMIT: 'EVENT_EMIT',
    // ui
    UI_RENDER: 'UI_RENDER',
    UI_SHOW_TOAST: 'UI_SHOW_TOAST',
    // canvas
    CANVAS_FRAME: 'CANVAS_FRAME',
    CANVAS_COMMIT_STROKE: 'CANVAS_COMMIT_STROKE',
    // media
    MEDIA_LOAD: 'MEDIA_LOAD',
    MEDIA_PLAY: 'MEDIA_PLAY',
    MEDIA_PAUSE: 'MEDIA_PAUSE',
    MEDIA_SEEK: 'MEDIA_SEEK',
    MEDIA_SET_VOLUME: 'MEDIA_SET_VOLUME',
    MEDIA_DESTROY: 'MEDIA_DESTROY',
    MEDIA_SET_VISIBLE: 'MEDIA_SET_VISIBLE',
    MEDIA_SET_DEVICE_CONTROL: 'MEDIA_SET_DEVICE_CONTROL',
    // editor (worker → host: Inspector 用スキーマ報告。capability 不要)
    EDITOR_SCHEMA: 'EDITOR_SCHEMA',
    // core
    CMD_GRIP: 'CMD_GRIP',
    CMD_LOG: 'CMD_LOG',
    CMD_READY: 'CMD_READY',
    CMD_INIT_FAILED: 'CMD_INIT_FAILED',
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

/** Host → Guest (Worker) イベント。 */
export const HostEventType = {
    EVT_LIFECYCLE_INIT: 'EVT_LIFECYCLE_INIT',
    EVT_LIFECYCLE_TICK: 'EVT_LIFECYCLE_TICK',
    EVT_INPUT: 'EVT_INPUT',
    EVT_CUSTOM: 'EVT_CUSTOM',
    EVT_ENTITY_WATCH: 'EVT_ENTITY_WATCH',
    EVT_RPC_RESPONSE: 'EVT_RPC_RESPONSE',
    EVT_SCENE_ENTITY_UPDATED: 'EVT_SCENE_ENTITY_UPDATED',
    EVT_NETWORK_BROADCAST: 'EVT_NETWORK_BROADCAST',
    EVT_PLAYER_JOINED: 'EVT_PLAYER_JOINED',
    EVT_PLAYER_LEFT: 'EVT_PLAYER_LEFT',
    EVT_PLAYER_CURSOR_MOVED: 'EVT_PLAYER_CURSOR_MOVED',
    EVT_MEDIA_ENDED: 'EVT_MEDIA_ENDED',
    EVT_MEDIA_ERROR: 'EVT_MEDIA_ERROR',
    EVT_MEDIA_LOADED: 'EVT_MEDIA_LOADED',
    EVT_MEDIA_TIME_UPDATE: 'EVT_MEDIA_TIME_UPDATE',
    EVT_UI_ACTION: 'EVT_UI_ACTION',
} as const;
export type HostEventType = (typeof HostEventType)[keyof typeof HostEventType];

/** EVT_INPUT に乗る入力サブイベント。 */
export const InputEventType = {
    MOUSE_MOVE: 'MOUSE_MOVE',
    MOUSE_DOWN: 'MOUSE_DOWN',
    MOUSE_UP: 'MOUSE_UP',
    KEY_DOWN: 'KEY_DOWN',
    KEY_UP: 'KEY_UP',
    CONTEXT_MENU: 'CONTEXT_MENU',
    SCROLL: 'SCROLL',
    RESIZE: 'RESIZE',
    CURSOR_STYLE: 'CURSOR_STYLE',
} as const;
export type InputEventType = (typeof InputEventType)[keyof typeof InputEventType];
