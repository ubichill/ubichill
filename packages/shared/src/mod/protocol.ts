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
    NET_FETCH: 'NET_FETCH',
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
