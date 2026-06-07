/**
 * capability (plugin.json 宣言) と Worker コマンドの対応表。
 *
 * - CAPABILITY_COMMANDS : capability → 許可するコマンド一覧。PluginHostManager が
 *   宣言された capability の和集合を allowlist として使う。
 * - CMD_TO_HANDLER      : コマンド → それを処理する HostHandlers のキー。
 *   ハンドラー未接続の早期検知に使う (接続漏れを warn する)。
 */
import type { HostHandlers } from './types';

export const CAPABILITY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    'scene:read': ['SCENE_GET_ENTITY', 'SCENE_QUERY_ENTITIES'],
    'scene:update': [
        'SCENE_CREATE_ENTITY',
        'SCENE_UPDATE_ENTITY',
        'SCENE_DESTROY_ENTITY',
        'SCENE_SUBSCRIBE_ENTITY',
        'SCENE_UNSUBSCRIBE_ENTITY',
    ],
    'net:fetch': ['NET_FETCH'],
    'net:broadcast': ['NETWORK_BROADCAST'],
    'net:host-message': ['NETWORK_SEND_TO_HOST'],
    'net:emit': ['EVENT_EMIT'],
    'ui:toast': ['UI_SHOW_TOAST'],
    'ui:render': ['UI_RENDER'],
    'avatar:set': ['AVATAR_SET'],
    'canvas:draw': ['CANVAS_FRAME', 'CANVAS_COMMIT_STROKE'],
    'video:control': [
        'MEDIA_LOAD',
        'MEDIA_PLAY',
        'MEDIA_PAUSE',
        'MEDIA_SEEK',
        'MEDIA_SET_VOLUME',
        'MEDIA_DESTROY',
        'MEDIA_SET_VISIBLE',
    ],
};

/**
 * Worker コマンドとそれを処理する HostHandlers のキーの対応。
 * HostHandlers に新しいハンドラーを追加したらここにも追記する。
 */
export const CMD_TO_HANDLER = {
    SCENE_GET_ENTITY: 'onGetEntity',
    SCENE_QUERY_ENTITIES: 'onQueryEntities',
    SCENE_CREATE_ENTITY: 'onCreateEntity',
    SCENE_UPDATE_ENTITY: 'onUpdateEntity',
    SCENE_DESTROY_ENTITY: 'onDestroyEntity',
    NET_FETCH: 'onFetch',
    NETWORK_SEND_TO_HOST: 'onMessage',
    NETWORK_BROADCAST: 'onNetworkBroadcast',
    EVENT_EMIT: 'onEventEmit',
    UI_RENDER: 'onRender',
    CANVAS_FRAME: 'onCanvasFrame',
    CANVAS_COMMIT_STROKE: 'onCanvasCommitStroke',
    MEDIA_LOAD: 'onMediaLoad',
    MEDIA_PLAY: 'onMediaPlay',
    MEDIA_PAUSE: 'onMediaPause',
    MEDIA_SEEK: 'onMediaSeek',
    MEDIA_SET_VOLUME: 'onMediaSetVolume',
    MEDIA_DESTROY: 'onMediaDestroy',
    MEDIA_SET_VISIBLE: 'onMediaSetVisible',
    CMD_GRIP: 'onGripCommand',
} as const satisfies Partial<Record<string, keyof HostHandlers>>;
