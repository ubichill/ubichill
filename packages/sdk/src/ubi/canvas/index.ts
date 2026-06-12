import { type CanvasCursorData, type CanvasStrokeData, CommandType } from '@ubichill/shared';
import type { SendFn } from '../types';

export type CanvasModule = {
    /**
     * 毎フレームのキャンバス描画状態をホストに送信する。
     * `cursors` は配列 (自分 + リモートユーザーぶん) を一度に渡す。
     */
    frame(targetId: string, options: { activeStroke?: CanvasStrokeData | null; cursors?: CanvasCursorData[] }): void;
    commitStroke(targetId: string, stroke: CanvasStrokeData): void;
};

export function createCanvasModule(send: SendFn): CanvasModule {
    return {
        frame: (targetId, options) =>
            send({
                type: CommandType.CANVAS_FRAME,
                payload: {
                    targetId,
                    activeStroke: options.activeStroke ?? null,
                    cursors: options.cursors ?? [],
                },
            }),
        commitStroke: (targetId, stroke) =>
            send({ type: CommandType.CANVAS_COMMIT_STROKE, payload: { targetId, stroke } }),
    };
}
