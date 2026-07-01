/**
 * capability (plugin.json 宣言) と Worker コマンドの対応表。
 *
 * - CAPABILITY_COMMANDS : capability → 許可するコマンド一覧。PluginHostManager が
 *   宣言された capability の和集合を allowlist として使う。
 * - CMD_TO_HANDLER      : コマンド → それを処理する HostHandlers のキー。
 *   ハンドラー未接続の早期検知に使う (接続漏れを warn する)。
 *
 * コマンド名は shared の CommandType カタログを参照する (文字列の散在防止)。
 */
import { CommandType } from '@ubichill/shared';
import type { HostHandlers } from './types';

export const CAPABILITY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    'scene:read': [CommandType.SCENE_GET_ENTITY, CommandType.SCENE_QUERY_ENTITIES],
    'scene:update': [
        CommandType.SCENE_CREATE_ENTITY,
        CommandType.SCENE_UPDATE_ENTITY,
        CommandType.SCENE_DESTROY_ENTITY,
        CommandType.SCENE_SUBSCRIBE_ENTITY,
        CommandType.SCENE_UNSUBSCRIBE_ENTITY,
    ],
    'net:fetch': [CommandType.NET_FETCH],
    'net:broadcast': [CommandType.NETWORK_BROADCAST],
    'net:host-message': [CommandType.NETWORK_SEND_TO_HOST],
    'net:emit': [CommandType.EVENT_EMIT],
    'ui:toast': [CommandType.UI_SHOW_TOAST],
    'ui:render': [CommandType.UI_RENDER],
    'avatar:set': ['AVATAR_SET'],
    'canvas:draw': [CommandType.CANVAS_FRAME, CommandType.CANVAS_COMMIT_STROKE],
    'video:control': [
        CommandType.MEDIA_LOAD,
        CommandType.MEDIA_PLAY,
        CommandType.MEDIA_PAUSE,
        CommandType.MEDIA_SEEK,
        CommandType.MEDIA_SET_VOLUME,
        CommandType.MEDIA_DESTROY,
        CommandType.MEDIA_SET_VISIBLE,
        CommandType.MEDIA_SET_DEVICE_CONTROL,
    ],
};

/**
 * Worker コマンドとそれを処理する HostHandlers のキーの対応。
 * HostHandlers に新しいハンドラーを追加したらここにも追記する。
 */
export const CMD_TO_HANDLER = {
    [CommandType.SCENE_GET_ENTITY]: 'onGetEntity',
    [CommandType.SCENE_QUERY_ENTITIES]: 'onQueryEntities',
    [CommandType.SCENE_CREATE_ENTITY]: 'onCreateEntity',
    [CommandType.SCENE_UPDATE_ENTITY]: 'onUpdateEntity',
    [CommandType.SCENE_DESTROY_ENTITY]: 'onDestroyEntity',
    [CommandType.NET_FETCH]: 'onFetch',
    [CommandType.NETWORK_SEND_TO_HOST]: 'onMessage',
    [CommandType.NETWORK_BROADCAST]: 'onNetworkBroadcast',
    [CommandType.EVENT_EMIT]: 'onEventEmit',
    [CommandType.UI_RENDER]: 'onRender',
    [CommandType.CANVAS_FRAME]: 'onCanvasFrame',
    [CommandType.CANVAS_COMMIT_STROKE]: 'onCanvasCommitStroke',
    [CommandType.MEDIA_LOAD]: 'onMediaLoad',
    [CommandType.MEDIA_PLAY]: 'onMediaPlay',
    [CommandType.MEDIA_PAUSE]: 'onMediaPause',
    [CommandType.MEDIA_SEEK]: 'onMediaSeek',
    [CommandType.MEDIA_SET_VOLUME]: 'onMediaSetVolume',
    [CommandType.MEDIA_DESTROY]: 'onMediaDestroy',
    [CommandType.MEDIA_SET_VISIBLE]: 'onMediaSetVisible',
    [CommandType.MEDIA_SET_DEVICE_CONTROL]: 'onMediaSetDeviceControl',
    [CommandType.EDITOR_SCHEMA]: 'onEditorSchema',
    [CommandType.CMD_GRIP]: 'onGripCommand',
} as const satisfies Partial<Record<string, keyof HostHandlers>>;
