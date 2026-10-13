/**
 * Host ⇔ Worker のプロトコルの契約（版ごとのコマンド・イベントの一覧）。公開している SDK と Host の間の約束なので、
 * 黙って変えないよう protocol.contract.test.ts が今の定義と照らし合わせる。
 *
 * 変えるとき（docs/PROTOCOLS.md）:
 * - 足す: PROTOCOL_VERSION を +1 し、この一覧の末尾に新しい版を足す（古い版の行は書き換えない）
 * - 消す・意味を変える（破壊的）: さらに MIN_COMPATIBLE_PROTOCOL_VERSION を新しい版まで上げる
 */
export interface ProtocolContract {
    version: number;
    commands: readonly string[];
    events: readonly string[];
    inputEvents: readonly string[];
}

export const PROTOCOL_CONTRACTS: readonly ProtocolContract[] = [
    {
        version: 5,
        commands: [
            'SCENE_GET_ENTITY',
            'SCENE_QUERY_ENTITIES',
            'SCENE_CREATE_ENTITY',
            'SCENE_UPDATE_ENTITY',
            'SCENE_DESTROY_ENTITY',
            'SCENE_SUBSCRIBE_ENTITY',
            'SCENE_UNSUBSCRIBE_ENTITY',
            'NETWORK_FETCH',
            'ASSET_LOAD',
            'IDENTITY_TOKEN',
            'NETWORK_BROADCAST',
            'NETWORK_SEND_TO_HOST',
            'EVENT_EMIT',
            'UI_RENDER',
            'UI_SHOW_TOAST',
            'CANVAS_FRAME',
            'CANVAS_COMMIT_STROKE',
            'MEDIA_LOAD',
            'MEDIA_PLAY',
            'MEDIA_PAUSE',
            'MEDIA_SEEK',
            'MEDIA_SET_VOLUME',
            'MEDIA_DESTROY',
            'MEDIA_SET_VISIBLE',
            'MEDIA_SET_DEVICE_CONTROL',
            'EDITOR_SCHEMA',
            'CMD_GRIP',
            'CMD_RIDE',
            'CMD_LOG',
            'CMD_ABORT',
            'CMD_READY',
            'CMD_INIT_FAILED',
        ],
        events: [
            'EVT_LIFECYCLE_INIT',
            'EVT_LIFECYCLE_TICK',
            'EVT_INPUT',
            'EVT_CUSTOM',
            'EVT_ENTITY_WATCH',
            'EVT_RPC_RESPONSE',
            'EVT_SCENE_ENTITY_UPDATED',
            'EVT_NETWORK_BROADCAST',
            'EVT_PLAYER_JOINED',
            'EVT_PLAYER_LEFT',
            'EVT_PLAYER_CURSOR_MOVED',
            'EVT_MEDIA_ENDED',
            'EVT_MEDIA_ERROR',
            'EVT_MEDIA_LOADED',
            'EVT_MEDIA_TIME_UPDATE',
            'EVT_MEDIA_STATE',
            'EVT_UI_ACTION',
        ],
        inputEvents: [
            'MOUSE_MOVE',
            'MOUSE_DOWN',
            'MOUSE_UP',
            'KEY_DOWN',
            'KEY_UP',
            'CONTEXT_MENU',
            'SCROLL',
            'RESIZE',
            'CURSOR_STYLE',
        ],
    },
];

export type ProtocolContractProblem = string;

const removed = (before: readonly string[], after: readonly string[]) => before.filter((x) => !after.includes(x));
const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && removed(a, b).length === 0 && removed(b, a).length === 0;

/** 今の定義が契約の一覧と食い違っていないか（純粋）。問題の説明を返す（空なら合っている）。 */
export function protocolContractProblems(
    current: {
        version: number;
        minCompatible: number;
        commands: readonly string[];
        events: readonly string[];
        inputEvents: readonly string[];
    },
    contracts: readonly ProtocolContract[],
): ProtocolContractProblem[] {
    const latest = contracts.at(-1);
    if (!latest) return ['契約の一覧が空です'];
    const ordering = contracts.slice(1).flatMap((c, i) => {
        const prev = contracts[i];
        return prev && c.version <= prev.version
            ? [`契約の版が増えていません（v${prev.version} の次が v${c.version}）`]
            : [];
    });
    const breaking = contracts.slice(1).flatMap((c, i) => {
        const prev = contracts[i];
        if (!prev) return [];
        const gone = [
            ...removed(prev.commands, c.commands),
            ...removed(prev.events, c.events),
            ...removed(prev.inputEvents, c.inputEvents),
        ];
        return gone.length > 0 && current.minCompatible < c.version
            ? [
                  `v${c.version} で ${gone.join(', ')} を消しています（破壊的変更）。MIN_COMPATIBLE_PROTOCOL_VERSION を ${c.version} 以上にしてください`,
              ]
            : [];
    });
    const drift =
        current.version !== latest.version
            ? [
                  `PROTOCOL_VERSION（${current.version}）が契約の最新の版（${latest.version}）と違います。契約の一覧に新しい版を足してください`,
              ]
            : !sameSet(current.commands, latest.commands) ||
                !sameSet(current.events, latest.events) ||
                !sameSet(current.inputEvents, latest.inputEvents)
              ? [
                    `コマンド・イベントが v${latest.version} の契約と違います（足した: ${
                        [
                            ...removed(current.commands, latest.commands),
                            ...removed(current.events, latest.events),
                            ...removed(current.inputEvents, latest.inputEvents),
                        ].join(', ') || 'なし'
                    } / 消した: ${
                        [
                            ...removed(latest.commands, current.commands),
                            ...removed(latest.events, current.events),
                            ...removed(latest.inputEvents, current.inputEvents),
                        ].join(', ') || 'なし'
                    }）。PROTOCOL_VERSION を上げ、契約の一覧に新しい版を足してください`,
                ]
              : [];
    return [...ordering, ...breaking, ...drift];
}
