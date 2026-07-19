/**
 * Worker コマンドと、それを処理する HostHandlers キーの対応。
 * ハンドラー接続漏れの早期検知（HANDLER_NOT_CONNECTED 診断）に使う host 固有のマップ。
 * HostHandlers に新しいハンドラーを追加したらここにも追記する。
 */
import { CommandType } from '@ubichill/shared';
import type { HostHandlers } from './types';

export const CMD_TO_HANDLER = {
    [CommandType.SCENE_GET_ENTITY]: 'onGetEntity',
    [CommandType.SCENE_QUERY_ENTITIES]: 'onQueryEntities',
    [CommandType.SCENE_CREATE_ENTITY]: 'onCreateEntity',
    [CommandType.SCENE_UPDATE_ENTITY]: 'onUpdateEntity',
    [CommandType.SCENE_DESTROY_ENTITY]: 'onDestroyEntity',
    [CommandType.NETWORK_FETCH]: 'onFetch',
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
