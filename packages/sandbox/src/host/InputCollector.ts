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

export class InputCollector {
    /** フレーム内の最新マウス位置（上書きデデュプ） */
    private _latestMousePos: InputFrameEvent | null = null;

    /** クリック・キーなどの離散イベント（すべて保持） */
    private _discreteEvents: InputFrameEvent[] = [];

    private readonly _onMouseMove: (e: MouseEvent) => void;
    private readonly _onMouseDown: (e: MouseEvent) => void;
    private readonly _onMouseUp: (e: MouseEvent) => void;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;
    private readonly _onKeyUp: (e: KeyboardEvent) => void;

    constructor() {
        // MOUSE_MOVE: スロットを上書きするだけ — O(1)
        this._onMouseMove = (e: MouseEvent) => {
            this._latestMousePos = {
                type: 'MOUSE_MOVE',
                data: {
                    x: e.clientX + window.scrollX,
                    y: e.clientY + window.scrollY,
                    buttons: e.buttons,
                },
            };
        };

        // 離散イベント: 全件保持
        this._onMouseDown = (e: MouseEvent) => {
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
    }
}
