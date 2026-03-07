/**
 * Pen Plugin - Worker ↔ Host 通信型定義
 *
 * Pen プラグインの通信プロトコルをここで定義します。
 * 型安全なメッセージングにより、IDE補完とコンパイル時チェックが可能です。
 */

import type { PluginHostMessage, PluginMessagingSchema, PluginWorkerMessage } from '@ubichill/sdk';

/**
 * Worker が Host へ送信するメッセージ
 *
 * @example
 * ```ts
 * Ubi.messaging.send('DRAWING_UPDATE', { points: [...] });
 * ```
 */
export type PenWorkerMessage = PluginWorkerMessage<
    'DRAWING_UPDATE' | 'STROKE_COMPLETE' | 'DRAWING_CLEAR',
    {
        /** 描画中のストロークポイント（リアルタイムプレビュー用） */
        DRAWING_UPDATE: {
            points: Array<[x: number, y: number, pressure: number]>;
        };

        /** ストロークの完成。永続化される */
        STROKE_COMPLETE: {
            points: Array<[x: number, y: number, pressure: number]>;
        };

        /** 描画キャンセル・クリア */
        DRAWING_CLEAR: Record<string, never>;
    }
>;

/**
 * Host が Worker へ送信するメッセージ
 *
 * @example
 * ```ts
 * Ubi.messaging.on('MOUSE_MOVE', ({ x, y, buttons }) => { ... });
 * ```
 */
export type PenHostMessage = PluginHostMessage<
    'MOUSE_MOVE' | 'MOUSE_DOWN' | 'MOUSE_UP',
    {
        /** マウス移動イベント */
        MOUSE_MOVE: {
            x: number;
            y: number;
            /** マウスボタン状態 (0=なし, 1=左, 3=左+右) */
            buttons: number;
        };

        /** マウスボタン押下 */
        MOUSE_DOWN: {
            x: number;
            y: number;
            /** ボタン番号 (0=左, 1=中央, 2=右) */
            button: 0 | 1 | 2;
        };

        /** マウスボタン解放 */
        MOUSE_UP: {
            x: number;
            y: number;
            button: 0 | 1 | 2;
        };
    }
>;

/**
 * Pen プラグインの通信スキーマ
 *
 * 型推論の基盤となります。
 */
export type PenMessagingSchema = PluginMessagingSchema<PenWorkerMessage, PenHostMessage>;
