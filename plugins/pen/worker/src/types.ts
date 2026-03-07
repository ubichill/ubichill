/**
 * Pen Plugin - Worker ↔ Host 通信型定義
 *
 * Pen プラグインの通信プロトコルをここで定義します。
 * 型安全なメッセージングにより、IDE補完とコンパイル時チェックが可能です。
 */

import type { PluginWorkerMessage } from '@ubichill/sdk';

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
