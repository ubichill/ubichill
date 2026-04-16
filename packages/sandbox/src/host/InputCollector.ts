/**
 * InputCollector
 *
 * DOM の入力イベント（マウス・キーボード・リサイズ）を収集し、
 * 毎フレームの Tick 送信時にまとめて Worker へ渡すためのバッファ。
 *
 * ## 座標系
 *
 * マウスイベントは 2 つの座標を含む:
 * - x/y          … ワールド座標 (clientX + scrollLeft)
 * - viewportX/Y  … ビューポート座標 (clientX/clientY)
 *
 * ワールドスクロールは div で起きるため window.scrollX/Y は常に 0。
 * スクロール要素は setScrollElement() で登録する。
 *
 * ## アルゴリズム: MOUSE_MOVE の上書きデデュプ (O(1))
 *
 * フレーム内に複数の mousemove が届いても、Worker に必要なのは
 * そのフレームの「最終位置」だけ。
 * そのため MOUSE_MOVE は専用スロット _latestMousePos に上書き保持し、
 * クリック・キーなどの離散イベントのみ _discreteEvents に積む。
 * SCROLL / RESIZE も同様に最終値のみ保持する。
 *
 * flush 時のコスト: O(k)  k = 離散イベント数（通常 0〜3）
 *   → mousemove が 100 件来ても collectSince は配列長 k+1 を返すだけ
 *
 * PluginHostManager が内部で保持し、_sendTick() の直前に collectSince() を呼ぶ。
 * プラグイン開発者は Frontend コードを一切書かずに入力を受け取れる。
 */

import type { InputFrameEvent } from '@ubichill/shared';

type SequencedInputFrameEvent = {
    seq: number;
    event: InputFrameEvent;
};

/**
 * クリック対象が plugin UI 要素（button, input, a 等）の場合 true を返す。
 *
 * トレイや設定パネル上の mousedown/mouseup はドローイング入力として
 * 全 Worker へ転送しない。これにより「UI パネルをクリックすると誤描画される」
 * 問題をプラグインごとの対応なしに解決する。
 * mousemove はカーソル追跡に必要なため対象外。
 */
function _isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest('button, input, select, textarea, a[href], [role="button"], label') !== null;
}

export class InputCollector {
    /** フレーム内の最新マウス位置（上書きデデュプ） */
    private _latestMousePos: SequencedInputFrameEvent | null = null;

    /** フレーム内の最新スクロール状態（上書きデデュプ） */
    private _latestScroll: SequencedInputFrameEvent | null = null;

    /** フレーム内の最新リサイズ状態（上書きデデュプ） */
    private _latestResize: SequencedInputFrameEvent | null = null;

    /** クリック・キーなどの離散イベント（すべて保持） */
    private _discreteEvents: SequencedInputFrameEvent[] = [];

    /** 収集イベントの連番。各コンシューマは最終連番以降だけを取得できる。 */
    private _seq = 0;

    /** 直近のビューポート座標。スクロール時のワールド座標再計算に使う。 */
    private _lastViewportPos: { x: number; y: number } | null = null;

    /** 直近のマウスボタン状態。スクロール由来の MOUSE_MOVE に正確な buttons を埋める。 */
    private _currentButtons = 0;

    /** mouseover で追跡している最新の computed cursor スタイル */
    private _cursorStyle = 'default';

    /** スクロール量を供給するスクロール要素 */
    private _scrollEl: Element | null = null;

    private readonly _onMouseMove: (e: MouseEvent) => void;
    private readonly _onMouseDown: (e: MouseEvent) => void;
    private readonly _onMouseUp: (e: MouseEvent) => void;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;
    private readonly _onKeyUp: (e: KeyboardEvent) => void;
    private readonly _onMouseOver: (e: MouseEvent) => void;
    private readonly _onContextMenu: (e: MouseEvent) => void;
    private readonly _onResize: () => void;
    private _onScroll: (() => void) | null = null;

    private _nextSeq(): number {
        this._seq += 1;
        return this._seq;
    }

    constructor() {
        this._onMouseMove = (e: MouseEvent) => {
            const scrollLeft = this._scrollEl?.scrollLeft ?? 0;
            const scrollTop = this._scrollEl?.scrollTop ?? 0;
            this._lastViewportPos = { x: e.clientX, y: e.clientY };
            this._currentButtons = e.buttons;
            this._latestMousePos = {
                seq: this._nextSeq(),
                event: {
                    type: 'MOUSE_MOVE',
                    data: {
                        x: e.clientX + scrollLeft,
                        y: e.clientY + scrollTop,
                        viewportX: e.clientX,
                        viewportY: e.clientY,
                        buttons: e.buttons,
                        cursorStyle: this._cursorStyle,
                    },
                },
            };
        };

        // MOUSE_OVER: computed cursor スタイルを追跡（mousemove より低頻度）
        this._onMouseOver = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (!target) return;
            this._cursorStyle = window.getComputedStyle(target).cursor || 'default';
        };

        // CONTEXT_MENU: 右クリックメニューを抑制し離散イベントとして積む（UI 要素は除外）
        this._onContextMenu = (e: MouseEvent) => {
            if (_isInteractiveTarget(e.target)) return;
            e.preventDefault();
            const scrollLeft = this._scrollEl?.scrollLeft ?? 0;
            const scrollTop = this._scrollEl?.scrollTop ?? 0;
            this._lastViewportPos = { x: e.clientX, y: e.clientY };
            this._discreteEvents.push({
                seq: this._nextSeq(),
                event: {
                    type: 'CONTEXT_MENU',
                    data: {
                        x: e.clientX + scrollLeft,
                        y: e.clientY + scrollTop,
                        viewportX: e.clientX,
                        viewportY: e.clientY,
                    },
                },
            });
        };

        // 離散イベント: UI 要素上は無視、それ以外は全件保持
        this._onMouseDown = (e: MouseEvent) => {
            if (_isInteractiveTarget(e.target)) return;
            const scrollLeft = this._scrollEl?.scrollLeft ?? 0;
            const scrollTop = this._scrollEl?.scrollTop ?? 0;
            this._lastViewportPos = { x: e.clientX, y: e.clientY };
            this._currentButtons = e.buttons;
            this._discreteEvents.push({
                seq: this._nextSeq(),
                event: {
                    type: 'MOUSE_DOWN',
                    data: {
                        x: e.clientX + scrollLeft,
                        y: e.clientY + scrollTop,
                        viewportX: e.clientX,
                        viewportY: e.clientY,
                        button: e.button,
                    },
                },
            });
        };

        this._onMouseUp = (e: MouseEvent) => {
            if (_isInteractiveTarget(e.target)) return;
            const scrollLeft = this._scrollEl?.scrollLeft ?? 0;
            const scrollTop = this._scrollEl?.scrollTop ?? 0;
            this._lastViewportPos = { x: e.clientX, y: e.clientY };
            this._currentButtons = e.buttons;
            this._discreteEvents.push({
                seq: this._nextSeq(),
                event: {
                    type: 'MOUSE_UP',
                    data: {
                        x: e.clientX + scrollLeft,
                        y: e.clientY + scrollTop,
                        viewportX: e.clientX,
                        viewportY: e.clientY,
                        button: e.button,
                    },
                },
            });
        };

        this._onKeyDown = (e: KeyboardEvent) => {
            this._discreteEvents.push({
                seq: this._nextSeq(),
                event: {
                    type: 'KEY_DOWN',
                    data: { key: e.key, code: e.code },
                },
            });
        };

        this._onKeyUp = (e: KeyboardEvent) => {
            this._discreteEvents.push({
                seq: this._nextSeq(),
                event: {
                    type: 'KEY_UP',
                    data: { key: e.key, code: e.code },
                },
            });
        };

        this._onResize = () => {
            this._latestResize = {
                seq: this._nextSeq(),
                event: {
                    type: 'RESIZE',
                    data: { width: window.innerWidth, height: window.innerHeight },
                },
            };
        };

        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mouseover', this._onMouseOver);
        window.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('resize', this._onResize, { passive: true });
    }

    /**
     * ワールドスクロールを供給する要素を登録する。
     * 登録後のマウスイベントでワールド座標 (x/y) が正しく計算される。
     * null を渡すと登録解除。
     */
    public setScrollElement(el: Element | null): void {
        if (this._scrollEl && this._onScroll) {
            this._scrollEl.removeEventListener('scroll', this._onScroll);
        }
        this._scrollEl = el;
        if (el) {
            this._onScroll = () => {
                this._latestScroll = {
                    seq: this._nextSeq(),
                    event: {
                        type: 'SCROLL',
                        data: { x: el.scrollLeft, y: el.scrollTop },
                    },
                };

                // スクロールだけが発生したフレームでもワールド座標を更新する。
                if (this._lastViewportPos) {
                    this._latestMousePos = {
                        seq: this._nextSeq(),
                        event: {
                            type: 'MOUSE_MOVE',
                            data: {
                                x: this._lastViewportPos.x + el.scrollLeft,
                                y: this._lastViewportPos.y + el.scrollTop,
                                viewportX: this._lastViewportPos.x,
                                viewportY: this._lastViewportPos.y,
                                buttons: this._currentButtons,
                                cursorStyle: this._cursorStyle,
                            },
                        },
                    };
                }
            };
            el.addEventListener('scroll', this._onScroll, { passive: true });
        } else {
            this._onScroll = null;
        }
    }

    /**
     * lastSeq より後に到着したイベントのみを取得する。
     * 返却する lastSeq を次回呼び出しへ渡すと重複なく同期できる。
     */
    public collectSince(lastSeq: number): { events: InputFrameEvent[]; lastSeq: number } {
        const batch: SequencedInputFrameEvent[] = [];

        for (const item of this._discreteEvents) {
            if (item.seq > lastSeq) batch.push(item);
        }
        if (this._latestMousePos && this._latestMousePos.seq > lastSeq) {
            batch.push(this._latestMousePos);
        }
        if (this._latestScroll && this._latestScroll.seq > lastSeq) {
            batch.push(this._latestScroll);
        }
        if (this._latestResize && this._latestResize.seq > lastSeq) {
            batch.push(this._latestResize);
        }

        batch.sort((a, b) => a.seq - b.seq);
        return {
            events: batch.map((item) => item.event),
            lastSeq: this._seq,
        };
    }

    /**
     * 全コンシューマが処理済みの連番までを破棄してメモリ使用量を抑える。
     */
    public pruneEventsBefore(minSeq: number): void {
        this._discreteEvents = this._discreteEvents.filter((item) => item.seq > minSeq);
        if (this._latestMousePos && this._latestMousePos.seq <= minSeq) {
            this._latestMousePos = null;
        }
        if (this._latestScroll && this._latestScroll.seq <= minSeq) {
            this._latestScroll = null;
        }
        if (this._latestResize && this._latestResize.seq <= minSeq) {
            this._latestResize = null;
        }
    }

    public destroy(): void {
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('mouseover', this._onMouseOver);
        window.removeEventListener('contextmenu', this._onContextMenu);
        window.removeEventListener('resize', this._onResize);
        if (this._scrollEl && this._onScroll) {
            this._scrollEl.removeEventListener('scroll', this._onScroll);
        }
    }
}
