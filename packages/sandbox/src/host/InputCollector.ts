/**
 * InputCollector
 *
 * DOM の入力イベント（マウス・キーボード）を収集し、
 * 毎フレームの Tick 送信時にまとめて Worker へ渡すためのバッファ。
 *
 * ## アルゴリズム: MOUSE_MOVE の上書きデデュプ (O(1))
 *
 * フレーム内に複数の mousemove が届いても、Worker に必要なのは
 * そのフレームの「最終位置」だけ。
 * そのため MOUSE_MOVE は専用スロット _latestMousePos に上書き保持し、
 * クリック・キーなどの離散イベントのみ _discreteEvents に積む。
 *
 * flush 時のコスト: O(k)  k = 離散イベント数（通常 0〜3）
 *   → mousemove が 100 件来ても flushEvents は配列長 k+1 を返すだけ
 *
 * PluginHostManager が内部で保持し、_sendTick() の直前に flushEvents() を呼ぶ。
 * プラグイン開発者は Frontend コードを一切書かずに入力を受け取れる。
 */

import type { InputFrameEvent } from '@ubichill/shared';

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
    private _latestMousePos: InputFrameEvent | null = null;

    /** クリック・キーなどの離散イベント（すべて保持） */
    private _discreteEvents: InputFrameEvent[] = [];

    /** mouseover で追跡している最新の computed cursor スタイル */
    private _cursorStyle = 'default';

    private readonly _onMouseMove: (e: MouseEvent) => void;
    private readonly _onMouseDown: (e: MouseEvent) => void;
    private readonly _onMouseUp: (e: MouseEvent) => void;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;
    private readonly _onKeyUp: (e: KeyboardEvent) => void;
    private readonly _onMouseOver: (e: MouseEvent) => void;
    private readonly _onContextMenu: (e: MouseEvent) => void;

    constructor() {
        // MOUSE_MOVE: スロットを上書きするだけ — O(1)
        this._onMouseMove = (e: MouseEvent) => {
            this._latestMousePos = {
                type: 'MOUSE_MOVE',
                data: {
                    x: e.clientX + window.scrollX,
                    y: e.clientY + window.scrollY,
                    buttons: e.buttons,
                    cursorStyle: this._cursorStyle,
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
            this._discreteEvents.push({
                type: 'CONTEXT_MENU',
                data: {
                    x: e.clientX + window.scrollX,
                    y: e.clientY + window.scrollY,
                    clientX: e.clientX,
                    clientY: e.clientY,
                },
            });
        };

        // 離散イベント: UI 要素上は無視、それ以外は全件保持
        this._onMouseDown = (e: MouseEvent) => {
            if (_isInteractiveTarget(e.target)) return;
            this._discreteEvents.push({
                type: 'MOUSE_DOWN',
                data: {
                    x: e.clientX + window.scrollX,
                    y: e.clientY + window.scrollY,
                    button: e.button,
                },
            });
        };

        this._onMouseUp = (e: MouseEvent) => {
            if (_isInteractiveTarget(e.target)) return;
            this._discreteEvents.push({
                type: 'MOUSE_UP',
                data: {
                    x: e.clientX + window.scrollX,
                    y: e.clientY + window.scrollY,
                    button: e.button,
                },
            });
        };

        this._onKeyDown = (e: KeyboardEvent) => {
            this._discreteEvents.push({
                type: 'KEY_DOWN',
                data: { key: e.key, code: e.code },
            });
        };

        this._onKeyUp = (e: KeyboardEvent) => {
            this._discreteEvents.push({
                type: 'KEY_UP',
                data: { key: e.key, code: e.code },
            });
        };

        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mouseover', this._onMouseOver);
        window.addEventListener('contextmenu', this._onContextMenu);
    }

    /**
     * バッファを取得してリセット。
     *
     * 返り値: [...離散イベント, MOUSE_MOVE の最終位置?]
     * MOUSE_MOVE は末尾に 1 件だけ追加されるため、
     * System がループすると「クリック → 位置確定」の自然な順序になる。
     */
    public flushEvents(): InputFrameEvent[] {
        const events = this._latestMousePos
            ? [...this._discreteEvents, this._latestMousePos]
            : this._discreteEvents.slice();

        this._discreteEvents = [];
        this._latestMousePos = null;
        return events;
    }

    public destroy(): void {
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('mouseover', this._onMouseOver);
        window.removeEventListener('contextmenu', this._onContextMenu);
    }
}
