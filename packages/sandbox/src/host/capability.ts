/**
 * capability カタログ — mod権限の単一の真実の源 (single source of truth)。
 *
 * 1 つの capability につき「危険度・許可コマンド・ユーザー向けの見える化情報 (label/description)」を
 * 1 箇所にまとめる。危険度マップとコマンドマップを別々に持つと同期漏れが起きるため、
 * 派生ビュー (CAPABILITY_COMMANDS / CAPABILITY_RISK) はここから機械的に生成する。
 *
 * - コマンド名は shared の CommandType カタログを参照する (文字列の散在防止)。
 * - CMD_TO_HANDLER はコマンド → HostHandlers キーの対応 (ハンドラー接続漏れの早期検知用)。
 */
import { CommandType } from '@ubichill/shared';
import type { HostHandlers } from './types';

/**
 * capability の危険度ティア。
 * - safe      : ワールド内で完結し外部副作用・情報流出が無い。常に自動許可。
 * - sensitive : ワールド状態を書き換えるが外部へは出ない。既定許可（ユーザー設定で要承認に変更可）。
 * - dangerous : 外部通信など情報流出/外部API操作のリスク。既定で明示承認を要求。
 */
export type CapabilityRisk = 'safe' | 'sensitive' | 'dangerous';

/** 1 つの capability の仕様。 */
export interface CapabilitySpec {
    /** 危険度ティア。 */
    readonly risk: CapabilityRisk;
    /** この capability が許可する Worker コマンド。 */
    readonly commands: readonly string[];
    /** UI 表示用の短いラベル（見える化）。 */
    readonly label: string;
    /** ユーザーに「何ができる権限か」を伝える 1 文（見える化）。 */
    readonly description: string;
}

/**
 * 全 capability のカタログ。ここが権限定義の唯一の出所。
 * 新しい capability を足すときは risk / commands / label / description を必ず揃える。
 */
export const CAPABILITY_CATALOG = {
    'scene:read': {
        risk: 'safe',
        commands: [CommandType.SCENE_GET_ENTITY, CommandType.SCENE_QUERY_ENTITIES],
        label: 'シーンの読み取り',
        description: 'ワールド内のオブジェクト情報を読み取る',
    },
    'ui:toast': {
        risk: 'safe',
        commands: [CommandType.UI_SHOW_TOAST],
        label: '通知の表示',
        description: '画面に一時的な通知（トースト）を表示する',
    },
    'ui:render': {
        risk: 'safe',
        commands: [CommandType.UI_RENDER],
        label: 'UI の描画',
        description: '自身の UI をワールド内に描画する',
    },
    'net:emit': {
        risk: 'safe',
        commands: [CommandType.EVENT_EMIT],
        label: 'ワールド内イベント送信',
        description: '同じワールド内の他コンポーネントへイベントを送る',
    },
    'scene:update': {
        risk: 'sensitive',
        commands: [
            CommandType.SCENE_CREATE_ENTITY,
            CommandType.SCENE_UPDATE_ENTITY,
            CommandType.SCENE_DESTROY_ENTITY,
            CommandType.SCENE_SUBSCRIBE_ENTITY,
            CommandType.SCENE_UNSUBSCRIBE_ENTITY,
        ],
        label: 'シーンの変更',
        description: 'ワールド内のオブジェクトを作成・変更・削除する',
    },
    'net:broadcast': {
        risk: 'sensitive',
        commands: [CommandType.NETWORK_BROADCAST],
        label: 'ブロードキャスト',
        description: 'ワールド内の全参加者へメッセージを一斉送信する',
    },
    'canvas:draw': {
        risk: 'sensitive',
        commands: [CommandType.CANVAS_FRAME, CommandType.CANVAS_COMMIT_STROKE],
        label: 'キャンバス描画',
        description: '共有キャンバスに線・図形を描く',
    },
    'video:control': {
        risk: 'sensitive',
        commands: [
            CommandType.MEDIA_LOAD,
            CommandType.MEDIA_PLAY,
            CommandType.MEDIA_PAUSE,
            CommandType.MEDIA_SEEK,
            CommandType.MEDIA_SET_VOLUME,
            CommandType.MEDIA_DESTROY,
            CommandType.MEDIA_SET_VISIBLE,
            CommandType.MEDIA_SET_DEVICE_CONTROL,
        ],
        label: 'メディア再生の制御',
        description: '動画・音声の読み込みと再生（再生/停止/シーク/音量）を操作する',
    },
    'avatar:set': {
        risk: 'sensitive',
        commands: ['AVATAR_SET'],
        label: 'アバターの変更',
        description: 'あなたのアバター表示を変更する',
    },
    'net:host-message': {
        // アプリ本体（ホスト）への片道通知（タブ内ローカル）。外部通信ではないため sensitive。
        // 例: modが自分のプレイヤー状態（アバター・ペン色など）の更新をホストに依頼する。
        risk: 'sensitive',
        commands: [CommandType.NETWORK_SEND_TO_HOST],
        label: 'ホストへの通知',
        description: 'アプリ本体にプレイヤー状態（アバター等）の更新を依頼する',
    },
    'net:fetch': {
        risk: 'dangerous',
        commands: [CommandType.NET_FETCH],
        label: '外部通信 (fetch)',
        description: '外部サーバーへ HTTP 通信する（許可したドメインのみ）',
    },
} as const satisfies Record<string, CapabilitySpec>;

/** カタログに定義済みの capability 名。 */
export type Capability = keyof typeof CAPABILITY_CATALOG;

/** capability → 許可コマンド一覧（カタログ由来の派生ビュー）。 */
export const CAPABILITY_COMMANDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    Object.entries(CAPABILITY_CATALOG).map(([cap, spec]) => [cap, spec.commands]),
);

/** capability → 危険度（カタログ由来の派生ビュー）。 */
export const CAPABILITY_RISK: Readonly<Record<string, CapabilityRisk>> = Object.fromEntries(
    Object.entries(CAPABILITY_CATALOG).map(([cap, spec]) => [cap, spec.risk]),
);

/**
 * コマンド → それを許可する capability の逆引き（カタログ由来の派生ビュー）。
 * on-demand 認可ゲートが「このコマンドはどの権限に属するか」を引くのに使う。
 */
export const COMMAND_TO_CAPABILITY: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(CAPABILITY_CATALOG).flatMap(([cap, spec]) => spec.commands.map((cmd) => [cmd, cap] as const)),
);

/**
 * capability の危険度を返す。未知の capability は最も危険な dangerous として扱い、
 * 「知らない権限は既定で承認を要求する」フェイルセーフを保証する。
 */
export function getCapabilityRisk(capability: string): CapabilityRisk {
    return (CAPABILITY_CATALOG as Record<string, CapabilitySpec>)[capability]?.risk ?? 'dangerous';
}

/** capability を人間に説明するための情報（見える化）。 */
export interface CapabilityInfo {
    readonly capability: string;
    readonly risk: CapabilityRisk;
    readonly label: string;
    readonly description: string;
    /** カタログに定義がある既知の capability か。未知なら false。 */
    readonly known: boolean;
}

/**
 * capability を UI/診断で表示するための説明を返す。
 * 未知の capability も安全側 (dangerous) の説明として必ず値を返す。
 */
export function describeCapability(capability: string): CapabilityInfo {
    const spec = (CAPABILITY_CATALOG as Record<string, CapabilitySpec>)[capability];
    if (spec) {
        return { capability, risk: spec.risk, label: spec.label, description: spec.description, known: true };
    }
    return {
        capability,
        risk: 'dangerous',
        label: capability,
        description: '不明な権限（安全のため既定で承認が必要）',
        known: false,
    };
}

/** カタログ全 capability の説明一覧（設定画面などの見える化用）。 */
export function listCapabilities(): CapabilityInfo[] {
    return Object.keys(CAPABILITY_CATALOG).map(describeCapability);
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
 * これが唯一の allowlist 生成経路であり、ModHostManager の capability ゲートはこの結果に従う。
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
