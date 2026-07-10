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
 * capability の危険度ティア。
 * - safe      : ワールド内で完結し外部副作用・情報流出が無い。常に自動許可。
 * - sensitive : ワールド状態を書き換えるが外部へは出ない。既定許可（ユーザー設定で要承認に変更可）。
 * - dangerous : 外部通信など情報流出/外部API操作のリスク。既定で明示承認を要求。
 */
export type CapabilityRisk = 'safe' | 'sensitive' | 'dangerous';

/** capability → 危険度ティア。カタログに無い capability は dangerous 扱い（フェイルセーフ）。 */
export const CAPABILITY_RISK: Readonly<Record<string, CapabilityRisk>> = {
    'scene:read': 'safe',
    'ui:toast': 'safe',
    'ui:render': 'safe',
    'net:emit': 'safe',
    'scene:update': 'sensitive',
    'net:broadcast': 'sensitive',
    'canvas:draw': 'sensitive',
    'video:control': 'sensitive',
    'avatar:set': 'sensitive',
    'net:host-message': 'dangerous',
    'net:fetch': 'dangerous',
};

/**
 * capability の危険度を返す。未知の capability は最も危険な dangerous として扱い、
 * 「知らない権限は既定で承認を要求する」フェイルセーフを保証する。
 */
export function getCapabilityRisk(capability: string): CapabilityRisk {
    return CAPABILITY_RISK[capability] ?? 'dangerous';
}

/**
 * capability 宣言の有無に関わらず常に許可するコアコマンド。
 * - CMD_LOG      : デバッグログ（制限すると開発体験が著しく悪化）
 * - CMD_READY    : Worker の初期化通知（必須）
 * - CMD_GRIP     : SDK コアの「掴む」機能（pen.worker 等が普通に使う）
 * - EDITOR_SCHEMA: エディタ用スキーマ通知
 */
export const ALWAYS_ALLOWED_COMMANDS: readonly string[] = ['CMD_LOG', 'CMD_READY', 'CMD_GRIP', 'EDITOR_SCHEMA'];

/**
 * 宣言された capability から、許可する Worker コマンドの allowlist を構築する。
 *
 * - `capabilities` が undefined でもコアコマンドのみの default-deny になる（全許可はしない）。
 * - 未知の capability は対応コマンドを持たないため単に無視される（コマンドは増えない）。
 *
 * これが唯一の allowlist 生成経路であり、PluginHostManager の capability ゲートはこの結果に従う。
 */
export function buildAllowedCommands(capabilities: readonly string[] | undefined): Set<string> {
    const allowed = new Set<string>(ALWAYS_ALLOWED_COMMANDS);
    for (const cap of capabilities ?? []) {
        for (const cmd of CAPABILITY_COMMANDS[cap] ?? []) {
            allowed.add(cmd);
        }
    }
    return allowed;
}

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
