/**
 * Ubi.grip — 自エンティティを「掴める / 持てるオブジェクト」として宣言する SDK プリミティブ。
 *
 * Pure ECS 上で「ユーザーが今このエンティティを掴んでいる」状態を扱うのは多くの
 * プラグイン (pen / ペット / ホワイトボードのカードなど) に共通する関心事。
 * 各プラグインが lockedBy + 1 ユーザー 1 本ルールを毎回書くのは冗長で、しかも
 * 競合条件 (query → update の隙に同時 click) を取りこぼしやすい。
 *
 * このモジュールは:
 *  - 占有者を ComponentInstance.lockedBy (top-level) として永続同期する
 *  - acquire() 時に「同じ Component type の全 worker」(scope='world') に内部 emit で
 *    「離せ」を伝える。兄弟階層に依らない世界横断ルール ("1 ユーザー = 同種 1 つ") を実現
 *  - 同時取得は acquireEpoch (Date.now) の新しい方が勝つ調停を SDK 側で完結
 *  - 受け手側プラグインは ev.type を意識しなくていい (event 名前空間は予約済み)
 *  - CMD_GRIP_HOLD/RELEASE でホストに通知 → EntityRenderer がカーソル追従描画を担う
 */

import type { CmdGrip } from '@ubichill/shared';
import type { EventModule } from '../event';
import type { StateModule } from '../state';

const GRIP_CLAIM_EVENT = '__ubi__:grip:claim';

interface GripClaim {
    userId: string;
    senderId: string;
    epoch: number;
}

export interface Grip {
    /** 現在掴んでいるユーザー (`null` = 誰も掴んでない) */
    readonly holder: string | null;
    /** 自分が掴んでいるか */
    readonly isMine: boolean;
    /** 他人が掴んでいるか */
    readonly isHeldByOther: boolean;
    /** 宣言時に渡された options (Gripable が hover/held のスタイルを引くのに使う、読み取り専用) */
    readonly options: Readonly<GripOptions>;
    /** 掴む。1 ユーザー 1 つの制約を SDK が同タブ siblings に対して enforce する。 */
    acquire(): void;
    /** 離す。任意の着地座標を指定できる */
    release(dropCoords?: { x: number; y: number }): void;
    /** mode に応じて acquire / release を切替える (toggle 風の操作にそのまま使える) */
    toggle(): void;
    /** 占有者の変化を監視。戻り関数で unregister。 */
    onChange(listener: (next: string | null, prev: string | null) => void): () => void;
}

/**
 * エンティティを掴む時の動作を設定するオプション。
 */
export interface GripOptions {
    /**
     * 解放トリガーの種類。デフォルト: 'manual'（後方互換）
     *
     * - 'manual'  : acquire() で掴み、明示的に release() を呼ぶまで保持する。
     *               ペンのように「トレイ再クリックで離す」場合はこれ。
     * - 'toggle'  : acquire() 時に既に isMine なら自動で release() する。
     *               クリックのたびに持つ/離すをトグルする。
     * - 'press'   : acquire() 後、mouseup イベントで自動 release() する。
     *               マウス押しっぱなし中だけ持つドラッグ感覚。
     */
    mode?: 'manual' | 'toggle' | 'press';

    /**
     * ホバー時のカーソル形状 + 視覚効果。
     * `<Gripable>` でラップしたとき自動適用される。
     */
    hover?: {
        /** ホバー時のカーソル CSS (デフォルト: 'grab') */
        cursor?: string;
        /** 保持中のカーソル CSS (デフォルト: 'grabbing') */
        heldCursor?: string;
        /** ホバー時の outline (例: '2px solid currentColor')。SDK が wrapper に適用 */
        outline?: string;
        /** ホバー時の scale (例: 1.05)。SDK が wrapper に transform で適用 */
        scale?: number;
    };

    /**
     * 自分が掴んでいる時のスタイル。`<Gripable>` でラップしたとき自動適用される。
     */
    held?: {
        /** 自分が掴んでいる時の opacity (デフォルト: 0.5 — トレイ上で「持ち上げた」表現) */
        opacity?: number;
    };

    /**
     * 他人が掴んでいる時のスタイル。`<Gripable>` でラップしたとき自動適用される。
     */
    blockedByOther?: {
        /** 他人が掴んでいる時の opacity (デフォルト: 0.35) */
        opacity?: number;
    };

    /**
     * エンティティをどの「スロット」に持つか（将来の拡張ポイント）。
     *
     * Stage 1（今回）: 'default' のみ実装。offsetX/Y でオフセット計算。
     * 将来: 'right-hand' / 'left-hand' でアバターのアタッチポイントに配置できる。
     */
    slot?: 'default' | 'right-hand' | 'left-hand' | (string & {});

    /**
     * 保持状態の同期範囲。
     *
     * - 'local'      : このブラウザ内のみ。lockedBy パッチなし・cursor:move に含めない。
     * - 'presence'   : cursor:moved で volatile 同期（軽量）。lockedBy は同期しない。
     * - 'persistent' : lockedBy を entity:patch でサーバー永続化 + cursor:moved でも同期。
     *                  切断時に自動解放される。（デフォルト・ペンはこれ）
     */
    share?: 'local' | 'presence' | 'persistent';

    /**
     * カーソル位置からのエンティティオフセット（px）。
     * slot='default' の場合に使用。
     * デフォルト: { x: -24, y: 0 }（カーソルの少し左）
     */
    offset?: { x?: number; y?: number };
}

export type GripModuleDeps = {
    state: StateModule;
    event: EventModule;
    getMyUserId(): string | undefined;
    getComponentInstanceId(): string | undefined;
    getComponentType(): string | undefined;
    /** 自 Worker が乗っている GameObject の id */
    getEntityId(): string | undefined;
    /**
     * mouseup イベントを一度だけ listen し、コールバックを呼ぶ。
     * press モードの自動解放に使用。戻り値は unsubscribe 関数。
     */
    listenMouseUp(cb: () => void): () => void;
    /** CMD_GRIP コマンドをホストへ送信する */
    sendGripCommand(payload: CmdGrip['payload']): void;
};

export type GripModule = {
    /**
     * 自エンティティを「同じ Component type の中で 1 ユーザー 1 つだけ掴める」
     * 排他オブジェクトとして公開する。
     *
     * ```ts
     * // pen.worker — 既存コードはそのまま動く（mode: 'manual' がデフォルト）
     * const grip = Ubi.grip.exclusive();
     * onUbiClick={() => grip.isMine ? grip.release() : grip.acquire()}
     * grip.onChange(renderPen);
     *
     * // toggle モード — クリックのたびに持つ/離すをトグル
     * const grip = Ubi.grip.exclusive({ mode: 'toggle' });
     * onUbiClick={() => grip.acquire()} // SDK が isMine 時に release() に切り替える
     *
     * // press モード — マウス押しっぱなし中だけ持つ
     * const grip = Ubi.grip.exclusive({ mode: 'press' });
     * onUbiClick={() => grip.acquire()} // mouseup で自動解放
     * ```
     */
    exclusive(opts?: GripOptions): Grip;
};

export function createGripModule(deps: GripModuleDeps): GripModule {
    return {
        exclusive: (opts: GripOptions = {}): Grip => {
            const mode = opts.mode ?? 'manual';
            const share = opts.share ?? 'persistent';
            const offsetX = opts.offset?.x ?? -24;
            const offsetY = opts.offset?.y ?? 0;
            const slot = opts.slot ?? 'default';

            // 占有者は top-level lockedBy として永続同期 (share='persistent' の場合のみ)
            // share が 'local' / 'presence' の場合はローカル専用（マーカーなし = ローカル専用）
            const inner = deps.state.define({
                holder:
                    share === 'persistent'
                        ? deps.state.sync<string | null>(null, { topLevel: 'lockedBy' })
                        : (null as string | null),
            });

            // ローカルでだけ持つ取得時刻。同時 click の調停に使う
            let acquireEpoch = 0;
            // press モードの mouseup unsubscribe
            let cancelMouseUp: (() => void) | null = null;

            const listeners = new Set<(next: string | null, prev: string | null) => void>();
            inner.onChange('holder', (next, prev) => {
                const me = deps.getMyUserId();
                // ゴースト防止: 自分の hold が外的要因 (他人の emit による奪取・サーバー patch・
                // entity:patched での lockedBy = null など) で外れた場合も、host (HoldContext) へ
                // CMD_GRIP release を必ず送る。release() を経由しない release も漏らさず host に
                // 伝えることで cursor 追従が居残るのを防ぐ。
                if (prev === me && next !== me) {
                    deps.sendGripCommand({
                        action: 'release',
                        entityId: deps.getComponentInstanceId() ?? '',
                    });
                }
                for (const fn of listeners) fn(next as string | null, prev as string | null);
            });

            // 同タブ siblings からの「占有を奪った」通知を受け取る
            const gripEvents = deps.event.define<{ '__ubi__:grip:claim': GripClaim }>();
            gripEvents.on(GRIP_CLAIM_EVENT, ({ userId, senderId, epoch }) => {
                if (senderId === deps.getComponentInstanceId()) return;
                if (inner.local.holder !== userId) return;
                if (acquireEpoch > epoch) return;
                inner.local.holder = null;
            });

            // ホバーカーソルの設定をホストに送る
            if (opts.hover) {
                deps.sendGripCommand({
                    action: 'setHover',
                    cursor: opts.hover.cursor ?? 'grab',
                    heldCursor: opts.hover.heldCursor ?? 'grabbing',
                });
            }

            const grip: Grip = {
                get holder() {
                    return inner.local.holder;
                },
                get isMine() {
                    const me = deps.getMyUserId();
                    return me !== undefined && inner.local.holder === me;
                },
                get isHeldByOther() {
                    const me = deps.getMyUserId();
                    const h = inner.local.holder;
                    return h !== null && h !== me;
                },
                options: opts,
                toggle(): void {
                    if (mode === 'manual') {
                        if (!grip.isMine && !grip.isHeldByOther) grip.acquire();
                        return;
                    }
                    if (grip.isMine) grip.release();
                    else if (!grip.isHeldByOther) grip.acquire();
                    // 他人が持っているなら何もしない (visual で disabled に見えるはず)
                },
                acquire(): void {
                    const me = deps.getMyUserId();
                    const self = deps.getComponentInstanceId();
                    const type = deps.getComponentType();
                    if (!me || !self || !type) return;

                    // toggle モード: 既に自分が持っていたら release に切り替え
                    if (mode === 'toggle' && grip.isMine) {
                        grip.release();
                        return;
                    }

                    const epoch = Date.now();
                    acquireEpoch = epoch;
                    inner.local.holder = me;

                    if (share === 'persistent') {
                        // 1 ユーザー = 同種 1 つ ルール: 他の同型 Worker へ「離せ」を通知
                        gripEvents.emit(
                            GRIP_CLAIM_EVENT,
                            { userId: me, senderId: self, epoch },
                            { scope: 'world', targetType: type },
                        );
                    }

                    // ホストへ CMD_GRIP hold を送信 → EntityRenderer がカーソル追従開始
                    deps.sendGripCommand({
                        action: 'hold',
                        entityId: self,
                        offsetX,
                        offsetY,
                        slot,
                        share,
                    });

                    // press モード: mouseup で自動解放
                    if (mode === 'press') {
                        cancelMouseUp?.();
                        cancelMouseUp = deps.listenMouseUp(() => {
                            cancelMouseUp = null;
                            grip.release();
                        });
                    }
                },
                release(dropCoords?: { x: number; y: number }): void {
                    const entityId = deps.getEntityId() ?? deps.getComponentInstanceId() ?? '';

                    // press モードの mouseup listener をキャンセル
                    cancelMouseUp?.();
                    cancelMouseUp = null;

                    inner.local.holder = null;

                    // ホストへ CMD_GRIP release を送信 → EntityRenderer がカーソル追従終了
                    deps.sendGripCommand({
                        action: 'release',
                        entityId,
                        dropX: dropCoords?.x,
                        dropY: dropCoords?.y,
                    });
                },
                onChange(listener): () => void {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };

            return grip;
        },
    };
}
